import { buildGraph } from '../../graph/buildGraph.ts';
import type { GraphData, GraphNode, PageRecord } from '../../graph/types.ts';
import { pageUrl } from '../../notion/urlToPageId.ts';
import { openIdbStore } from '../background/idbStore.ts';
import { IDLE_PROGRESS } from '../background/types.ts';
import type { Progress } from '../background/types.ts';
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
const notice = byId('notice');
const RELOAD_EVERY_MS = 2000;

let view: GraphView | undefined;
let lastGraph: GraphData = { nodes: [], links: [] };
let pagesById = new Map<string, PageRecord>();
let focusId: string | null = null;
let focusApplied = false;
let lastReload = 0;
let reloadTicket = 0;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;

const search = setupSearch(
  { input: byId<HTMLInputElement>('search'), list: byId<HTMLUListElement>('search-list'), live: byId('live') },
  (id) => view?.focusNode(id),
);

function publishReport(): void {
  const size = `${container.clientWidth}x${container.clientHeight}`;
  const report = `mode=${mode}, 점 ${lastGraph.nodes.length}개·선 ${lastGraph.links.length}개, 화면 크기=${size}, 그래프 만듦=${view ? '예' : '아니오'}, 현재 페이지=${focusId ? '있음' : '없음'}`;
  void chrome.storage.session.set({ graphReport: { at: Date.now(), report } });
}

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
  view = createGraphView(container, palette, { onNodeClick: openNode });
  return view;
}

async function reload(): Promise<void> {
  // 계층 스위치를 누른 읽기와 2초 갱신 읽기가 겹칠 수 있어서, 더 최근에 시작한 읽기의 결과만 쓴다
  const ticket = ++reloadTicket;
  lastReload = Date.now();
  const hierarchy = hierarchyBox.checked;
  const [pages, links] = await Promise.all([store.listPages(), store.allLinks()]);
  if (ticket !== reloadTicket) return;
  pagesById = new Map(pages.map((page) => [page.id, page]));
  lastGraph = buildGraph(pages, links, { hierarchy });
  search.setItems(lastGraph.nodes.filter((node) => !node.unreadable));
  byId('empty').hidden = lastGraph.nodes.length > 0;
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

function openNode(node: GraphNode): void {
  const url = pageUrl(node.id, pagesById.get(node.id)?.url);
  void openPage(mode, url).catch((error: unknown) => {
    notice.textContent = `이동하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`;
  });
}

function renderProgress(progress: Progress): void {
  byId('status').textContent = describeProgress(progress);
  byId<HTMLButtonElement>('reindex').disabled = progress.phase === 'running';
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

byId('reindex').addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'index', command: 'start' } satisfies Message);
});
byId('open-settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());
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
  const [local, session] = await Promise.all([chrome.storage.local.get('progress'), chrome.storage.session.get('focusPageId')]);
  renderProgress((local.progress as Progress | undefined) ?? IDLE_PROGRESS);
  focusId = typeof session.focusPageId === 'string' ? session.focusPageId : null;
  await reload();
}

void init();
