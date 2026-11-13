import { buildGraph } from '../../graph/buildGraph.ts';
import { applyFilters, SHOW_ALL } from '../../graph/filter.ts';
import type { KindFilter } from '../../graph/filter.ts';
import { buildRows, linkedPages } from '../../graph/rows.ts';
import type { NodeRow } from '../../graph/rows.ts';
import type { GraphData, PageRecord, RawLink } from '../../graph/types.ts';
import { pageUrl } from '../../notion/urlToPageId.ts';
import { createAnnouncer } from '../announce.ts';
import { openIdbStore } from '../background/idbStore.ts';
import { IDLE_PROGRESS } from '../background/types.ts';
import type { Progress, ProgressPhase } from '../background/types.ts';
import { byId } from '../dom.ts';
import { isViewMode } from '../messages.ts';
import type { Message, ViewMode } from '../messages.ts';
import { describeProgress } from '../progressText.ts';
import { renderLinks } from './linksPanel.ts';
import { createListView } from './listview.ts';
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
const viewToggle = byId<HTMLButtonElement>('view-toggle');
const notice = byId('notice');
const announce = createAnnouncer(byId('progress-live'));
const RELOAD_EVERY_MS = 2000;
const ZOOM_STEP = 1.5;
const EMPTY_TEXT = '아직 그릴 연결이 없어요. 설정에서 토큰을 넣고 "연결 지도 만들기"를 눌러 주세요.';
const FILTERED_TEXT = '모든 종류를 숨겼어요. 위의 점 종류 버튼을 눌러 다시 보이게 하세요.';

let view: GraphView | undefined;
let rawPages: PageRecord[] = [];
let rawLinks: RawLink[] = [];
let hidden: KindFilter = SHOW_ALL;
let lastGraph: GraphData = { nodes: [], links: [] };
let rows: NodeRow[] = [];
let rowsById = new Map<string, NodeRow>();
let pagesById = new Map<string, PageRecord>();
let focusId: string | null = null;
let focusApplied = false;
// 아이콘으로 연 지금 페이지를 한 번만 자동으로 골라 받은·보낸 연결을 보여 준다(그 뒤 사용자가 고른 것은 덮어쓰지 않는다)
let pickCurrent = false;
let selectedId: string | null = null;
// 사용자가 직접 확대·이동하기 전까지는 점이 늘거나 배치가 멈출 때마다 전체가 보이게 맞춘다
let autoFit = true;
let listMode = false;
let hasToken = false;
let phase: ProgressPhase = 'idle';
let lastReload = 0;
let reloadTicket = 0;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;

function openById(id: string): void {
  void openPage(mode, pageUrl(id, pagesById.get(id)?.url)).catch((error: unknown) => {
    notice.textContent = `페이지를 열지 못했어요: ${error instanceof Error ? error.message : String(error)}`;
  });
}

// 키보드 사용자가 검색으로 고른 페이지를 열 수 있게 선택 막대를 보여 주고 "Notion에서 열기"로 초점을 옮긴다(WCAG 2.1.1)
function select(id: string | null): void {
  selectedId = id;
  renderSelection();
  if (id === null || !rowsById.has(id)) return;
  autoFit = false;
  view?.focusNode(id);
  byId('sel-open').focus();
}

function renderSelection(): void {
  const row = selectedId === null ? undefined : rowsById.get(selectedId);
  byId('selection').hidden = row === undefined;
  byId('sel-title').textContent = row?.title ?? '';
  renderLinks(row ? linkedPages(lastGraph, row.id) : undefined, select);
}

const searchInput = byId<HTMLInputElement>('search');
const search = setupSearch({ input: searchInput, list: byId<HTMLUListElement>('search-list'), live: byId('live') }, (id) => {
  // 후보를 고르면 검색창 값이 코드로 바뀌어 input 이벤트가 나지 않으므로 목록 검색어도 직접 맞춘다
  list.setQuery(searchInput.value);
  select(id);
});
const list = createListView(byId<HTMLTableSectionElement>('list-body'), byId('list-note'), openById);

function applyData(target: GraphView): void {
  target.setData(lastGraph);
  const present = focusId !== null && lastGraph.nodes.some((node) => node.id === focusId);
  if (present && !focusApplied) {
    target.focusNode(focusId);
    focusApplied = true;
    autoFit = false;
  } else if (!present && focusApplied) {
    // 현재 페이지가 그래프에 없어졌으면 이전 강조를 지운다
    target.focusNode(null);
    focusApplied = false;
  }
  if (autoFit) target.fit();
}

// 사이드 패널은 처음 크기가 0일 수 있어서(시험 S-6) 크기가 생긴 뒤에 그래프를 만든다
function ensureView(): GraphView | undefined {
  if (view) return view;
  if (container.clientWidth === 0 || container.clientHeight === 0) return undefined;
  view = createGraphView(container, palette, {
    onNodeClick: (node) => openById(node.id),
    onSettled: () => {
      if (autoFit) view?.fit();
    },
  });
  return view;
}

// 범례로 모든 종류를 숨겨 점이 없을 때는 설정 안내 대신 숨김을 푸는 방법을 알려 준다
function renderEmpty(): void {
  const filteredOut = lastGraph.nodes.length === 0 && rawPages.length > 0 && (hidden.page || hidden.dbItem || hidden.unreadable);
  byId('empty').hidden = lastGraph.nodes.length > 0;
  byId('empty-text').textContent = filteredOut ? FILTERED_TEXT : EMPTY_TEXT;
  byId('empty-settings').hidden = filteredOut;
}

// 저장소를 다시 읽지 않고, 하위 페이지 스위치·범례 필터만 바꿔 다시 그린다
function rebuild(): void {
  lastGraph = applyFilters(buildGraph(rawPages, rawLinks, { hierarchy: hierarchyBox.checked }), hidden);
  rows = buildRows(lastGraph);
  rowsById = new Map(rows.map((row) => [row.id, row]));
  // 숨겨진 목록은 다시 그리지 않고, 보일 때 그린다
  if (listMode) list.setRows(rows);
  search.setItems(lastGraph.nodes.filter((node) => !node.unreadable));
  renderEmpty();
  if (pickCurrent && focusId !== null && rowsById.has(focusId)) {
    pickCurrent = false;
    selectedId = focusId;
  }
  if (selectedId !== null && !rowsById.has(selectedId)) select(null);
  else renderSelection();
  const target = ensureView();
  if (target) applyData(target);
}

async function reload(): Promise<void> {
  // 2초 갱신 읽기가 겹칠 수 있어서, 더 최근에 시작한 읽기의 결과만 쓴다
  const ticket = ++reloadTicket;
  lastReload = Date.now();
  const [pages, links] = await Promise.all([store.listPages(), store.allLinks()]);
  if (ticket !== reloadTicket) return;
  rawPages = pages;
  rawLinks = links;
  pagesById = new Map(pages.map((page) => [page.id, page]));
  rebuild();
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

for (const kind of ['page', 'dbItem', 'unreadable'] as const) {
  const button = byId<HTMLButtonElement>(kind === 'dbItem' ? 'legend-db' : `legend-${kind}`);
  button.addEventListener('click', () => {
    hidden = { ...hidden, [kind]: !hidden[kind] };
    button.setAttribute('aria-pressed', String(!hidden[kind]));
    rebuild();
  });
}

// 목록은 그래프를 못 보거나 키보드로 쓰는 사람을 위한 같은 내용의 다른 보기다
viewToggle.addEventListener('click', () => {
  listMode = !listMode;
  byId('graph-area').hidden = listMode;
  byId('list-view').hidden = !listMode;
  viewToggle.textContent = listMode ? '그래프로 보기' : '목록으로 보기';
  if (listMode) list.setRows(rows);
});
byId<HTMLInputElement>('search').addEventListener('input', (event) => {
  list.setQuery((event.target as HTMLInputElement).value);
});

byId('zoom-in').addEventListener('click', () => {
  autoFit = false;
  view?.zoomBy(ZOOM_STEP);
});
byId('zoom-out').addEventListener('click', () => {
  autoFit = false;
  view?.zoomBy(1 / ZOOM_STEP);
});
byId('zoom-fit').addEventListener('click', () => {
  autoFit = true;
  view?.fit();
});
for (const type of ['wheel', 'mousedown'] as const) {
  container.addEventListener(type, () => (autoFit = false), { passive: true });
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
hierarchyBox.addEventListener('change', rebuild);

new ResizeObserver(() => {
  const created = view === undefined;
  const target = ensureView();
  if (!target) return;
  target.resize(container.clientWidth, container.clientHeight);
  if (created) applyData(target);
  else if (autoFit) target.fit();
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
    pickCurrent = focusId !== null;
    focusApplied = false;
    // 강조할 페이지가 없어지면 다시 전체가 보이게 맞춘다
    if (focusId === null) autoFit = true;
    view?.focusNode(null);
    // 새 지금 페이지를 고르고 그 연결을 보여 주려면 선택 막대까지 다시 그려야 한다
    rebuild();
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
  pickCurrent = focusId !== null;
  await reload();
}

void init();
