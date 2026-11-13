import { buildGraph } from '../../graph/buildGraph.ts';
import type { GraphData, PageRecord } from '../../graph/types.ts';
import { pageUrl } from '../../notion/urlToPageId.ts';
import { createAnnouncer } from '../announce.ts';
import { openIdbStore } from '../background/idbStore.ts';
import { IDLE_PROGRESS } from '../background/types.ts';
import type { Progress, ProgressPhase } from '../background/types.ts';
import { byId } from '../dom.ts';
import { isViewMode } from '../messages.ts';
import type { Message, ViewMode } from '../messages.ts';
import { describeProgress } from '../progressText.ts';
import { openPage, switchMode } from './navigate.ts';
import { applyPaletteVars, currentPalette } from './palette.ts';
import { createGraphView } from './render.ts';
import type { GraphView } from './render.ts';
import { setupSearch } from './search.ts';

const requested = new URLSearchParams(location.search).get('mode');
const mode: ViewMode = isViewMode(requested) ? requested : 'full';
const palette = currentPalette();
applyPaletteVars(palette);

const store = openIdbStore();
const container = byId('graph');
const hierarchyBox = byId<HTMLInputElement>('hierarchy');
const reindexButton = byId<HTMLButtonElement>('reindex');
const notice = byId('notice');
const announce = createAnnouncer(byId('progress-live'));
const RELOAD_EVERY_MS = 2000;

let view: GraphView | undefined;
let lastGraph: GraphData = { nodes: [], links: [] };
let pagesById = new Map<string, PageRecord>();
let focusId: string | null = null;
let focusApplied = false;
let selectedId: string | null = null;
let hasToken = false;
let phase: ProgressPhase = 'idle';
let lastReload = 0;
let reloadTicket = 0;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;

function publishReport(): void {
  const size = `${container.clientWidth}x${container.clientHeight}`;
  const report = `mode=${mode}, 점 ${lastGraph.nodes.length}개·선 ${lastGraph.links.length}개, 화면 크기=${size}, 그래프 만듦=${view ? '예' : '아니오'}, 현재 페이지=${focusId ? '있음' : '없음'}`;
  void chrome.storage.session.set({ graphReport: { at: Date.now(), report } });
}

function openById(id: string): void {
  void openPage(mode, pageUrl(id, pagesById.get(id)?.url)).catch((error: unknown) => {
    notice.textContent = `페이지를 열지 못했어요: ${error instanceof Error ? error.message : String(error)}`;
  });
}

// 키보드 사용자가 검색으로 고른 페이지를 열 수 있게 선택 막대를 보여 주고 "Notion에서 열기"로 초점을 옮긴다(WCAG 2.1.1)
function select(id: string | null): void {
  selectedId = id;
  const title = id === null ? undefined : lastGraph.nodes.find((node) => node.id === id)?.title;
  byId('selection').hidden = title === undefined;
  byId('sel-title').textContent = title ?? '';
  if (title === undefined) return;
  view?.focusNode(id);
  byId('sel-open').focus();
}

const search = setupSearch(
  { input: byId<HTMLInputElement>('search'), list: byId<HTMLUListElement>('search-list'), live: byId('live') },
  select,
);

function applyData(target: GraphView): void {
  target.setData(lastGraph);
  const present = focusId !== null && lastGraph.nodes.some((node) => node.id === focusId);
  if (present && !focusApplied) {
    target.focusNode(focusId);
    focusApplied = true;
  } else if (!present && focusApplied) {
    // 현재 페이지가 그래프에 없어졌으면 이전 강조를 지운다
    target.focusNode(null);
    focusApplied = false;
  }
}

// 사이드 패널은 처음 크기가 0일 수 있어서(시험 S-6) 크기가 생긴 뒤에 그래프를 만든다
function ensureView(): GraphView | undefined {
  if (view) return view;
  if (container.clientWidth === 0 || container.clientHeight === 0) return undefined;
  view = createGraphView(container, palette, { onNodeClick: (node) => openById(node.id) });
  return view;
}

async function reload(): Promise<void> {
  // 하위 페이지 스위치를 누른 읽기와 2초 갱신 읽기가 겹칠 수 있어서, 더 최근에 시작한 읽기의 결과만 쓴다
  const ticket = ++reloadTicket;
  lastReload = Date.now();
  const hierarchy = hierarchyBox.checked;
  const [pages, links] = await Promise.all([store.listPages(), store.allLinks()]);
  if (ticket !== reloadTicket) return;
  pagesById = new Map(pages.map((page) => [page.id, page]));
  lastGraph = buildGraph(pages, links, { hierarchy });
  search.setItems(lastGraph.nodes.filter((node) => !node.unreadable));
  byId('empty').hidden = lastGraph.nodes.length > 0;
  if (selectedId !== null && !lastGraph.nodes.some((node) => node.id === selectedId)) select(null);
  const target = ensureView();
  if (target) applyData(target);
  publishReport();
}

// 색인 중에는 읽을 때마다 다시 그리지 않고 2초에 한 번만 갱신한다(F-15)
function scheduleReload(running: boolean): void {
  clearTimeout(reloadTimer);
  const wait = running ? Math.max(0, RELOAD_EVERY_MS - (Date.now() - lastReload)) : 0;
  reloadTimer = setTimeout(() => void reload(), wait);
}

const REINDEX_LABEL: Record<ProgressPhase, string> = {
  idle: '연결 지도 만들기',
  running: '만드는 중…',
  paused: '이어서 만들기',
  error: '이어서 만들기',
  done: '다시 만들기',
};

// 토큰이 없으면 눌러도 오류만 나므로 끄고 이유를 보여 준다
function renderReindex(): void {
  reindexButton.textContent = REINDEX_LABEL[phase];
  reindexButton.disabled = phase === 'running' || !hasToken;
  byId('reindex-hint').hidden = hasToken;
}

function renderProgress(progress: Progress): void {
  phase = progress.phase;
  byId('status').textContent = describeProgress(progress);
  announce(progress);
  renderReindex();
}

for (const target of ['side', 'center', 'full'] as const) {
  const button = byId<HTMLButtonElement>(`mode-${target}`);
  button.setAttribute('aria-pressed', String(target === mode));
  button.addEventListener('click', () => {
    void switchMode(target, mode).then((failure) => {
      notice.textContent = failure ?? '';
    });
  });
}

reindexButton.addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'index', command: 'start' } satisfies Message);
});
for (const id of ['open-settings', 'empty-settings']) byId(id).addEventListener('click', () => void chrome.runtime.openOptionsPage());
byId('sel-open').addEventListener('click', () => {
  if (selectedId !== null) openById(selectedId);
});
byId('sel-clear').addEventListener('click', () => {
  select(null);
  byId('search').focus();
});
hierarchyBox.addEventListener('change', () => void reload());

new ResizeObserver(() => {
  const created = view === undefined;
  const target = ensureView();
  if (!target) return;
  target.resize(container.clientWidth, container.clientHeight);
  if (created) applyData(target);
  publishReport();
}).observe(container);

chrome.storage.onChanged.addListener((changes, area) => {
  const progress = changes.progress?.newValue as Progress | undefined;
  if (area === 'local' && progress) {
    renderProgress(progress);
    scheduleReload(progress.phase === 'running');
  }
  if (area === 'local' && changes.token) {
    hasToken = typeof changes.token.newValue === 'string' && changes.token.newValue !== '';
    renderReindex();
  }
  const pageId: unknown = changes.focusPageId?.newValue;
  if (area === 'session' && changes.focusPageId) {
    focusId = typeof pageId === 'string' ? pageId : null;
    focusApplied = false;
    view?.focusNode(null);
    if (view) applyData(view);
    publishReport();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && mode === 'center') {
    void chrome.runtime.sendMessage({ type: 'close-overlay' } satisfies Message);
  }
});

async function init(): Promise<void> {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(['progress', 'token']),
    chrome.storage.session.get('focusPageId'),
  ]);
  hasToken = typeof local.token === 'string' && local.token !== '';
  renderProgress((local.progress as Progress | undefined) ?? IDLE_PROGRESS);
  focusId = typeof session.focusPageId === 'string' ? session.focusPageId : null;
  await reload();
}

void init();
