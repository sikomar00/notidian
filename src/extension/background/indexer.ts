import { checkToken, probeAccess } from '../../notion/endpoints.ts';
import { createNotionClient } from '../../notion/http.ts';
import { withRetry } from '../../notion/retry.ts';
import type { IndexCommand, SaveTokenReply, TokenKind } from '../messages.ts';
import { beginCrawl, runCrawl } from './crawl.ts';
import { readToken, writeToken } from '../tokenStore.ts';
import { learnDatabaseNames } from './databaseNames.ts';
import type { CrawlOutcome } from './crawl.ts';
import { openIdbStore } from './idbStore.ts';
import { IDLE_PROGRESS } from './types.ts';
import type { Progress } from './types.ts';

const ALARM = 'notidian-resume';
// 서비스 워커는 이벤트 하나가 5분을 넘으면 종료되므로 4분씩 조각내어 돌린다
const BUDGET_MS = 4 * 60_000;
const ALARM_MINUTES = 0.5;
const RATE_LIMIT_MESSAGE = 'Notion이 요청을 잠시 막았어요. 1~2분 뒤 "이어서 만들기"를 눌러 주세요';

const store = openIdbStore();
let running = false;
let stopRequested = false;
// 다시 만드는 동안 진행 상태를 새로 써도 마지막 완성 시각과 자동 실행 여부는 남긴다
const carried = (progress: Progress): Pick<Progress, 'finishedAt' | 'auto'> => ({
  ...(progress.finishedAt === undefined ? {} : { finishedAt: progress.finishedAt }),
  ...(progress.auto ? { auto: true } : {}),
});

async function readProgress(): Promise<Progress> {
  const { progress } = await chrome.storage.local.get('progress');
  return typeof progress === 'object' && progress !== null ? (progress as Progress) : IDLE_PROGRESS;
}

async function writeProgress(progress: Progress): Promise<void> {
  await chrome.storage.local.set({ progress });
}

// 색인이 끝나면 알람을 끄고 진행 상태를 남긴다. 조각이 끝났을 뿐이면(budget) 알람이 다음 조각을 깨운다
async function finish(outcome: CrawlOutcome): Promise<void> {
  if (outcome.kind === 'budget') return;
  await chrome.alarms.clear(ALARM);
  const { read, discovered } = await store.counts();
  const keep = carried(await readProgress());
  if (outcome.kind === 'done') await writeProgress({ ...keep, phase: 'done', read, discovered, finishedAt: Date.now() });
  // 사용자가 멈춘 것은 다음 주기에 이어 하지 않는다
  else if (outcome.kind === 'stopped') await writeProgress({ ...keep, auto: false, phase: 'paused', read, discovered });
  else if (outcome.reason === 'rate-limit') await writeProgress({ ...keep, phase: 'paused', read, discovered, lastError: RATE_LIMIT_MESSAGE });
  else await writeProgress({ ...keep, phase: 'error', read, discovered, lastError: outcome.message });
}

/**
 * 저장된 진행 위치에서 4분 동안 색인을 돌린다.
 * 도는 동안 알람을 반복으로 걸어 둔다. 서비스 워커가 중간에 꺼져도(응답이 30초 넘게 없거나 긴 대기 중) 알람이 깨워 이어서 돈다.
 */
async function runChunk(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const token = await readToken();
    if (!token) {
      await writeProgress({ ...(await readProgress()), phase: 'error', lastError: '토큰이 없어요. 설정에서 토큰을 저장해 주세요' });
      return;
    }
    await chrome.alarms.create(ALARM, { delayInMinutes: ALARM_MINUTES, periodInMinutes: ALARM_MINUTES });
    const keep = carried(await readProgress());
    const request = withRetry(createNotionClient(token), {
      onWait: (until) => void readProgress().then((progress) => writeProgress({ ...progress, waitingUntil: until })),
    });
    const outcome = await runCrawl(
      {
        request,
        store,
        now: Date.now,
        isStopped: () => stopRequested,
        onProgress: (read, discovered) => writeProgress({ ...keep, phase: 'running', read, discovered }),
      },
      Date.now() + BUDGET_MS,
    );
    await finish(outcome);
    // 다 만든 것을 먼저 기록한 뒤 처음 보는 DB의 이름을 묻는다(DB별 색의 범례). 실패해도 지도는 완성이고,
    // 이유는 그래프 범례에 보이도록 저장한다. 못 받은 이름은 다음 완성 때 다시 묻는다
    if (outcome.kind === 'done') {
      try {
        await learnDatabaseNames(request, await store.listPages());
        await chrome.storage.local.remove('databaseNamesError');
      } catch (error) {
        await chrome.storage.local.set({ databaseNamesError: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    running = false;
  }
}

/** 처음이든 "다시 색인"이든 시작한다. 중단·오류로 멈춘 색인이 있으면 처음부터가 아니라 이어서 한다. `auto`는 자동 다시 만들기가 시작했는지. */
export async function startIndex(auto = false): Promise<void> {
  if (running) return;
  const [progress, state] = await Promise.all([readProgress(), store.getCrawl()]);
  const resumable = state !== undefined && state.phase !== 'done' && (progress.phase === 'paused' || progress.phase === 'error');
  if (!resumable) await beginCrawl(store, Date.now);
  await writeProgress({ ...carried(progress), auto, ...(await store.counts()), phase: 'running' });
  stopRequested = false;
  void runChunk();
}

/** 돌고 있는 색인만 멈춘다(토큰을 지울 때). 돌고 있지 않으면 진행 상태를 건드리지 않는다. */
export async function stopIfRunning(): Promise<void> {
  if (running || (await readProgress()).phase === 'running') await stopIndex();
}

async function stopIndex(): Promise<void> {
  stopRequested = true;
  await chrome.alarms.clear(ALARM);
  if (!running) await writeProgress({ ...(await readProgress()), auto: false, phase: 'paused' });
}

async function clearIndex(): Promise<void> {
  await stopIndex();
  while (running) await new Promise((resolve) => setTimeout(resolve, 100));
  await store.clear();
  await chrome.storage.local.remove('databaseNames');
  // 예전 시험 패널이 남긴 페이지 목록 사본도 지운다(패널은 지웠지만 이미 저장된 사본이 남아 있을 수 있다)
  await chrome.storage.local.remove('spikeSnapshot');
  await writeProgress(IDLE_PROGRESS);
}

export async function handleIndexCommand(command: IndexCommand): Promise<void> {
  if (command === 'start') await startIndex();
  else if (command === 'stop') await stopIndex();
  else await clearIndex();
}

/** 붙여 넣은 토큰을 Notion에 한 번 물어 맞으면 저장한다(F-1). 토큰은 어떤 메시지·로그에도 넣지 않는다. */
export async function saveToken(token: string, kind: TokenKind): Promise<SaveTokenReply> {
  const trimmed = token.trim();
  if (trimmed === '') return { ok: false, message: '토큰을 입력해 주세요.' };
  const request = createNotionClient(trimmed);
  try {
    const result = await checkToken(request);
    if (!result.ok) {
      const reason =
        result.status === 401
          ? '토큰이 맞지 않아요. 만료됐거나 잘못 복사됐을 수 있어요. Notion에서 토큰을 다시 복사해 주세요.'
          : `Notion이 ${result.status} 오류를 돌려줬어요. 잠시 뒤 다시 시도해 주세요.`;
      return { ok: false, message: reason };
    }
  } catch {
    return { ok: false, message: 'Notion에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.' };
  }
  await writeToken(trimmed, kind);
  // 페이지를 연결에 추가하지 않은 채 끝내는 경우가 많아서, 저장 직후 읽을 수 있는 페이지 수를 알려 준다. 확인에 실패해도 저장은 그대로 둔다
  const access = await probeAccess(request).catch(() => undefined);
  return access ? { ok: true, pageCount: access.count, more: access.more } : { ok: true };
}

// 알람이 깨웠을 때, 중단·완료되지 않은 색인이면 이어서 돈다
function resumeIfRunning(): void {
  void readProgress().then((progress) => {
    if (progress.phase === 'running') void runChunk();
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) resumeIfRunning();
});
resumeIfRunning();
