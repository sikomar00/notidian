import type { PageRecord, UnreadableReason } from '../../graph/types.ts';
import {
  fetchPage,
  isUnauthorized,
  NotionApiError,
  readBlockTree,
  readRelationOverflow,
  reasonForStatus,
  searchPagesOnce,
} from '../../notion/endpoints.ts';
import type { NotionObject, Requester } from '../../notion/endpoints.ts';
import { extractFromBlock, extractFromProperties } from '../../notion/extractLinks.ts';
import { summarizePage } from '../../notion/pageMapping.ts';
import type { PageSummary } from '../../notion/pageMapping.ts';
import { RateLimitedError } from '../../notion/retry.ts';
import type { CrawlState, IndexStore } from './types.ts';

export interface CrawlDeps {
  request: Requester;
  store: IndexStore;
  now: () => number;
  isStopped: () => boolean;
  onProgress: (read: number, discovered: number) => Promise<void> | void;
}

export type CrawlOutcome =
  | { kind: 'done' }
  | { kind: 'budget' }
  | { kind: 'stopped' }
  | { kind: 'error'; reason: 'token' | 'rate-limit' | 'unexpected'; message: string };

type Signal = 'next' | 'budget' | 'stopped';

// 수정 시각이 분 단위로 내림되어, 읽은 시각이 수정 시각에서 이 안이면 다음 색인에서 한 번 더 읽는다(시험 S-4)
const RECENT_EDIT_MS = 2 * 60_000;
const MAX_FAILURES = 3;

const iso = (ms: number): string => new Date(ms).toISOString();

function interrupted(deps: CrawlDeps, deadline: number): Signal | undefined {
  if (deps.isStopped()) return 'stopped';
  return deps.now() >= deadline ? 'budget' : undefined;
}

async function report(deps: CrawlDeps): Promise<void> {
  const { read, discovered } = await deps.store.counts();
  await deps.onProgress(read, discovered);
}

/** 새 색인을 시작한다(처음이든 "다시 색인"이든). 기존 색인 내용은 지우지 않고 바뀐 것만 다시 읽는다. */
export async function beginCrawl(store: IndexStore, now: () => number): Promise<void> {
  await store.putCrawl({ phase: 'search', seenIds: [], startedAt: iso(now()) });
}

function needsRead(existing: PageRecord | undefined, summary: PageSummary): boolean {
  if (!existing || existing.status !== 'ok') return true;
  if (summary.lastEdited === '' || existing.lastEdited !== summary.lastEdited) return true;
  return existing.readAt !== undefined && Date.parse(existing.readAt) - Date.parse(existing.lastEdited) < RECENT_EDIT_MS;
}

// 이 페이지를 마지막으로 읽거나 존재를 확인한 시각
const lastSeenAt = (page: PageRecord): string => [page.readAt ?? '', page.checkedAt ?? ''].sort().at(-1) ?? '';

async function absorbSearchResult(deps: CrawlDeps, item: NotionObject, seen: Set<string>): Promise<void> {
  const summary = summarizePage(item);
  if (!summary) return;
  if (summary.inTrash) {
    await deps.store.deletePage(summary.id);
    return;
  }
  seen.add(summary.id);
  const existing = await deps.store.getPage(summary.id);
  const pending = needsRead(existing, summary);
  await deps.store.putPage({
    id: summary.id,
    title: summary.title,
    kind: summary.kind,
    url: summary.url,
    lastEdited: summary.lastEdited || existing?.lastEdited || '',
    ...(summary.parentPageId ? { parentPageId: summary.parentPageId } : {}),
    status: pending ? 'pending' : 'ok',
    failCount: pending ? (existing?.failCount ?? 0) : 0,
    ...(existing?.readAt ? { readAt: existing.readAt } : {}),
  });
}

async function searchPhase(deps: CrawlDeps, state: CrawlState, deadline: number): Promise<Signal> {
  const seen = new Set(state.seenIds);
  let cursor = state.searchCursor;
  do {
    const stop = interrupted(deps, deadline);
    if (stop) return stop;
    const page = await searchPagesOnce(deps.request, cursor);
    for (const item of page.results) await absorbSearchResult(deps, item, seen);
    cursor = page.nextCursor;
    await deps.store.putCrawl({ ...state, seenIds: [...seen], ...(cursor ? { searchCursor: cursor } : {}) });
    await report(deps);
  } while (cursor);
  await deps.store.putCrawl({ phase: 'cleanup', seenIds: [...seen], startedAt: state.startedAt });
  return 'next';
}

async function collectTargets(request: Requester, id: string, page: NotionObject): Promise<string[]> {
  const targets = new Set(extractFromProperties(page.properties));
  try {
    for (const target of await readRelationOverflow(request, id, page)) targets.add(target);
  } catch (error) {
    // relation 일부를 못 읽어도 나머지 연결은 저장한다(권한 없는 대상 등)
    if (!(error instanceof NotionApiError) || isUnauthorized(error) || !reasonForStatus(error.status)) throw error;
  }
  const { blocks } = await readBlockTree(request, id);
  for (const block of blocks) for (const target of extractFromBlock(block)) targets.add(target);
  targets.delete(id);
  return [...targets];
}

function withoutReason(record: PageRecord): PageRecord {
  const { unreadableReason: _reason, ...rest } = record;
  return rest;
}

async function markUnreadable(deps: CrawlDeps, record: PageRecord, reason: UnreadableReason): Promise<void> {
  await deps.store.replaceLinks(record.id, []);
  await deps.store.putPage({ ...record, status: 'unreadable', unreadableReason: reason, readAt: iso(deps.now()), failCount: 0 });
}

async function recordFailure(deps: CrawlDeps, record: PageRecord): Promise<void> {
  const failCount = record.failCount + 1;
  const status = failCount > MAX_FAILURES ? 'unreadable' : 'pending';
  await deps.store.putPage({
    ...record,
    status,
    failCount,
    ...(status === 'unreadable' ? { unreadableReason: 'error' as const } : {}),
  });
}

async function discover(deps: CrawlDeps, targets: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const id of targets) {
    if (await deps.store.getPage(id)) continue;
    await deps.store.putPage({ id, title: '', kind: 'page', url: '', lastEdited: '', status: 'pending', failCount: 0 });
    found.push(id);
  }
  return found;
}

/** 페이지 본문을 읽다 난 오류를 처리한다. 토큰 오류와 코드 오류는 올리고, 나머지는 그 페이지만의 문제로 둔다. */
async function handleReadError(deps: CrawlDeps, record: PageRecord, error: unknown): Promise<null | never[]> {
  if (!(error instanceof NotionApiError) || isUnauthorized(error)) throw error;
  const reason = error.status === 403 || error.status === 404 ? reasonForStatus(error.status) : undefined;
  if (reason) {
    await markUnreadable(deps, record, reason);
    return [];
  }
  // 5xx·409 등 일시 오류는 이 페이지만 실패로 세고 계속한다(F-8). 다음 색인에서 다시 읽는다
  await recordFailure(deps, record);
  return null;
}

/** 페이지 하나를 읽어 연결을 저장한다. 새로 발견한 페이지 ID를 돌려준다. `null`이면 일시 실패. */
async function readOne(deps: CrawlDeps, id: string): Promise<string[] | null> {
  const record = await deps.store.getPage(id);
  if (!record) return [];
  const fetched = await fetchPage(deps.request, id);
  if (fetched.kind === 'unreadable') {
    await markUnreadable(deps, record, fetched.reason);
    return [];
  }
  if (fetched.kind === 'failed') {
    await recordFailure(deps, record);
    return null;
  }
  const summary = summarizePage(fetched.page);
  if (!summary || summary.inTrash) {
    await deps.store.deletePage(id);
    return [];
  }
  let targets: string[];
  try {
    targets = await collectTargets(deps.request, id, fetched.page);
  } catch (error) {
    return handleReadError(deps, record, error);
  }
  const found = await discover(deps, targets);
  await deps.store.replaceLinks(id, targets);
  await deps.store.putPage({
    ...withoutReason(record),
    title: summary.title,
    kind: summary.kind,
    url: summary.url,
    lastEdited: summary.lastEdited,
    ...(summary.parentPageId ? { parentPageId: summary.parentPageId } : {}),
    status: 'ok',
    failCount: 0,
    readAt: iso(deps.now()),
  });
  return found;
}

// 이번 검색에 안 나온 저장 페이지가 아직 있는지 확인해, 바뀐 것은 읽을 페이지로 표시하고 사라진 것은 정리한다.
// 읽는 것은 다음 단계가 한꺼번에 한다. 확인한 페이지는 `checkedAt`을 남겨 이어서 돌 때 다시 확인하지 않는다.
async function cleanupPhase(deps: CrawlDeps, state: CrawlState, deadline: number): Promise<Signal> {
  const seen = new Set(state.seenIds);
  const stale = (await deps.store.listPages()).filter(
    (page) => page.status === 'ok' && !seen.has(page.id) && lastSeenAt(page) < state.startedAt,
  );
  for (const page of stale) {
    const stop = interrupted(deps, deadline);
    if (stop) return stop;
    await recheck(deps, page);
  }
  await deps.store.putCrawl({ ...state, phase: 'read' });
  return 'next';
}

async function recheck(deps: CrawlDeps, page: PageRecord): Promise<void> {
  const checkedAt = iso(deps.now());
  const fetched = await fetchPage(deps.request, page.id);
  if (fetched.kind === 'unreadable') {
    // 지워졌거나 접근을 잃은 페이지는 회색 점으로 남긴다. 그 페이지를 가리키던 연결은 그대로 둔다(F-5)
    await markUnreadable(deps, page, fetched.reason);
    return;
  }
  const summary = fetched.kind === 'ok' ? summarizePage(fetched.page) : undefined;
  if (fetched.kind === 'ok' && (!summary || summary.inTrash)) {
    await deps.store.deletePage(page.id);
    return;
  }
  if (summary && needsRead(page, summary)) {
    await deps.store.putPage({ ...page, title: summary.title, lastEdited: summary.lastEdited, status: 'pending', checkedAt });
    return;
  }
  await deps.store.putPage({ ...page, checkedAt });
}

async function readPhase(deps: CrawlDeps, state: CrawlState, deadline: number): Promise<Signal> {
  const queue = await deps.store.pendingIds();
  while (queue.length > 0) {
    const stop = interrupted(deps, deadline);
    if (stop) return stop;
    const id = queue.shift();
    if (id === undefined) break;
    const found = await readOne(deps, id);
    if (found) queue.push(...found);
    await report(deps);
  }
  await deps.store.putCrawl({ ...state, phase: 'done' });
  return 'next';
}

const PHASES = { search: searchPhase, cleanup: cleanupPhase, read: readPhase } as const;

function toErrorOutcome(error: unknown): CrawlOutcome {
  if (isUnauthorized(error)) return { kind: 'error', reason: 'token', message: '토큰이 맞지 않아요. 만료됐거나 잘못 복사됐을 수 있어요' };
  if (error instanceof RateLimitedError) return { kind: 'error', reason: 'rate-limit', message: error.message };
  return { kind: 'error', reason: 'unexpected', message: error instanceof Error ? error.message : '알 수 없는 오류' };
}

/** 저장된 진행 위치에서 마감 시각(`deadline`)까지 색인을 이어서 돌린다. 순서는 검색 → 정리 → 읽기다. */
export async function runCrawl(deps: CrawlDeps, deadline: number): Promise<CrawlOutcome> {
  try {
    for (;;) {
      const state = await deps.store.getCrawl();
      if (!state || state.phase === 'done') return { kind: 'done' };
      const signal = await PHASES[state.phase](deps, state, deadline);
      if (signal === 'budget') return { kind: 'budget' };
      if (signal === 'stopped') return { kind: 'stopped' };
    }
  } catch (error) {
    return toErrorOutcome(error);
  }
}
