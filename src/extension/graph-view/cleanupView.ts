import { buildMatcher, findAllMentions, sortGroups } from '../../graph/mentionIndex.ts';
import type { MentionGroup } from '../../graph/mentionIndex.ts';
import type { RawLink } from '../../graph/types.ts';
import { normalizeTitle } from '../../graph/unlinkedMentions.ts';
import type { Mention, PreparedText } from '../../graph/unlinkedMentions.ts';
import { byId } from '../dom.ts';
import { mentionName, mentionSnippet } from './mentionSnippet.ts';
import type { TextCache } from './textCache.ts';

// 한 번에 그리는 묶음 수(F-24). 나머지는 위의 것을 정리하면 올라온다
const MAX_GROUPS = 100;
// 이만큼씩 나눠 계산하고 사이에 쉬어 화면이 멈추지 않게 한다(NF-13)
const SLICE = 50;

export interface CleanupRequest {
  /** 범례로 숨기지 않은, 읽을 수 있는 페이지(F-26) */
  visible: ReadonlySet<string>;
  titleOf: (id: string) => string | undefined;
  links: readonly RawLink[];
  running: boolean;
  ignored: ReadonlySet<string>;
}

interface CleanupDeps {
  cache: TextCache;
  onOpen: (id: string) => void;
  /** 제목을 빼거나(true) 다시 넣는다(false) */
  onIgnore: (title: string, ignore: boolean) => void;
}

interface ButtonSpec {
  text: string;
  /** 다시 그린 뒤 초점을 되돌릴 때 같은 버튼을 찾는 열쇠 */
  key: string;
  label: string;
  onClick: () => void;
}

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const keyOf = (title: string): string => normalizeTitle(title) ?? title;

function button({ text, key, label, onClick }: ButtonSpec): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.dataset.key = key;
  element.setAttribute('aria-label', label);
  element.addEventListener('click', onClick);
  return element;
}

function linksFromOf(links: readonly RawLink[]): (id: string) => ReadonlySet<string> {
  const map = new Map<string, Set<string>>();
  for (const { from, to } of links) map.set(from, (map.get(from) ?? new Set()).add(to));
  const none = new Set<string>();
  return (id) => map.get(id) ?? none;
}

async function computeGroups(pages: readonly PreparedText[], request: CleanupRequest, stale: () => boolean): Promise<MentionGroup[] | null> {
  const targets = [...request.visible].flatMap((id) => {
    const title = request.titleOf(id);
    return title === undefined ? [] : [{ id, title }];
  });
  const matcher = buildMatcher(targets, request.ignored);
  const linksFrom = linksFromOf(request.links);
  const sources = pages.filter((page) => request.visible.has(page.id));
  const groups: MentionGroup[] = [];
  for (let from = 0; from < sources.length; from += SLICE) {
    groups.push(...findAllMentions(sources.slice(from, from + SLICE), matcher, linksFrom));
    await pause();
    if (stale()) return null;
  }
  return sortGroups(groups);
}

// 제목을 뺐을 때는 다시 계산하지 않고 지난 결과에서 그 제목만 걸러 바로 보여 준다(UJ-8 3단계)
function withoutIgnored(groups: readonly MentionGroup[], ignored: ReadonlySet<string>): MentionGroup[] {
  const kept = groups.flatMap((group) => {
    const mentions = group.mentions.filter((mention) => !ignored.has(keyOf(mention.title)));
    return mentions.length > 0 ? [{ ...group, mentions }] : [];
  });
  return sortGroups(kept);
}

/** 계정 전체의 연결 안 된 언급을 글자가 적힌 페이지별로 묶어 보여 준다(S2-8, F-23~F-27). */
export function createCleanupView({ cache, onOpen, onIgnore }: CleanupDeps) {
  const view = byId('cleanup-view');
  const status = byId('cleanup-note');
  const list = byId('cleanup-list');
  const ignoredBox = byId('cleanup-ignored');
  let ticket = 0;
  let last: MentionGroup[] = [];

  function mentionItem(group: MentionGroup, mention: Mention): HTMLLIElement {
    const li = document.createElement('li');
    const title = keyOf(mention.title);
    // 같은 제목이 여러 묶음에 있어도 초점이 다른 묶음으로 튀지 않게 묶음까지 열쇠에 넣는다
    const ignore = button({ text: '이 제목은 빼기', key: `ignore:${group.sourceId}:${title}`, label: `${mention.title} 제목은 빼기`, onClick: () => onIgnore(title, true) });
    li.append(mentionName(mention.title), ` · ${mention.count}곳 `, ignore, mentionSnippet(mention));
    return li;
  }

  function groupItem(group: MentionGroup): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'group';
    const heading = document.createElement('h3');
    heading.textContent = `${group.title} · 제목 ${group.mentions.length}개 `;
    heading.append(button({ text: 'Notion에서 열기', key: `open:${group.sourceId}`, label: `${group.title} Notion에서 열기`, onClick: () => onOpen(group.sourceId) }));
    const mentions = document.createElement('ul');
    mentions.append(...group.mentions.map((mention) => mentionItem(group, mention)));
    li.append(heading, mentions);
    return li;
  }

  function renderIgnored(ignored: ReadonlySet<string>): void {
    if (ignored.size === 0) {
      ignoredBox.replaceChildren();
      return;
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `뺀 제목 ${ignored.size}개 · 되돌리기`;
    const ul = document.createElement('ul');
    for (const title of [...ignored].sort((a, b) => a.localeCompare(b, 'ko'))) {
      const li = document.createElement('li');
      li.append(`${title} `, button({ text: '다시 넣기', key: `restore:${title}`, label: `${title} 다시 넣기`, onClick: () => onIgnore(title, false) }));
      ul.append(li);
    }
    // 다시 그려도 펼쳐 둔 상태를 유지한다
    details.open = ignoredBox.querySelector('details')?.open ?? false;
    details.append(summary, ul);
    ignoredBox.replaceChildren(details);
  }

  function show(groups: MentionGroup[], request: CleanupRequest): void {
    last = groups;
    // 다시 그려도 키보드 초점이 있던 버튼으로 되돌리고, 그 버튼이 사라졌으면(제목을 뺐을 때) 안내 문구로 옮긴다
    const focusedKey = view.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key : undefined;
    const items = groups.slice(0, MAX_GROUPS).map(groupItem);
    if (groups.length > MAX_GROUPS) {
      const more = document.createElement('li');
      more.textContent = `${groups.length - MAX_GROUPS}개 페이지 더 있어요`;
      items.push(more);
    }
    list.replaceChildren(...items);
    renderIgnored(request.ignored);
    status.textContent = request.running ? '연결 지도를 만드는 중이라 더 나올 수 있어요' : groups.length === 0 ? '글자로만 적은 곳이 없어요' : `페이지 ${groups.length}곳`;
    if (focusedKey === undefined) return;
    const again = view.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusedKey)}"]`);
    if (again) again.focus();
    else status.focus();
  }

  async function render(request: CleanupRequest): Promise<void> {
    const mine = ++ticket;
    status.textContent = '찾는 중…';
    let pages: PreparedText[];
    try {
      pages = await cache.get(request.titleOf);
    } catch (error) {
      if (mine === ticket) status.textContent = `본문 글자를 읽지 못했어요: ${error instanceof Error ? error.message : String(error)}`;
      return;
    }
    if (mine !== ticket) return;
    if (pages.length === 0 && !request.running) {
      last = [];
      list.replaceChildren();
      renderIgnored(request.ignored);
      status.textContent = '다시 만들기를 하면 보여요';
      return;
    }
    const groups = await computeGroups(pages, request, () => mine !== ticket);
    if (groups) show(groups, request);
  }

  return {
    render,
    /** 제목을 뺀 직후: 다시 계산하지 않고 지난 결과에서 걸러 바로 보여 준다 */
    hideIgnored(request: CleanupRequest): void {
      ticket += 1;
      show(withoutIgnored(last, request.ignored), request);
    },
    /** 숨길 때 진행 중인 계산을 버린다 */
    cancel(): void {
      ticket += 1;
    },
  };
}
