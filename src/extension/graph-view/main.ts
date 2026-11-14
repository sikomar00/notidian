import { buildGraph } from '../../graph/buildGraph.ts';
import { applyFilters, hideIsolated, localSubgraph, SHOW_ALL } from '../../graph/filter.ts';
import type { KindFilter } from '../../graph/filter.ts';
import { demoData } from '../../graph/demoData.ts';
import { buildRows, linkedPages } from '../../graph/rows.ts';
import type { NodeRow } from '../../graph/rows.ts';
import type { GraphData, PageRecord, RawLink } from '../../graph/types.ts';
import { pageUrl } from '../../notion/urlToPageId.ts';
import { openIdbStore } from '../background/idbStore.ts';
import { IDLE_PROGRESS } from '../background/types.ts';
import type { Progress } from '../background/types.ts';
import { byId } from '../dom.ts';
import { isViewMode } from '../messages.ts';
import type { Message, ViewMode } from '../messages.ts';
import { hasToken as tokenPresent, tokenChanged } from '../tokenStore.ts';
import { renderDatabaseLegend } from './databaseLegend.ts';
import { renderLinks } from './linksPanel.ts';
import { followTabs } from './follow.ts';
import { createListView } from './listview.ts';
import { openDemoTab } from '../containers.ts';
import { openPage, switchMode } from './navigate.ts';
import { applyPaletteVars, currentPalette } from './palette.ts';
import { createGraphView } from './render.ts';
import type { GraphView } from './render.ts';
import { setupExport } from './exporter.ts';
import { createReloader } from './reloader.ts';
import { setupSearch } from './search.ts';
import { createStatusLine } from './statusLine.ts';

const params = new URLSearchParams(location.search);
const requested = params.get('mode');
// 예시로 둘러보기(P2-7): 저장된 연결 지도 대신 브라우저 안에서 만든 가짜 데이터를 보여 주고, 저장소 변경으로 덮어쓰지 않는다
const demo = params.get('demo') === '1';
const mode: ViewMode = isViewMode(requested) ? requested : 'full';
const palette = currentPalette();
applyPaletteVars(palette);

const store = openIdbStore();
const container = byId('graph');
const hierarchyBox = byId<HTMLInputElement>('hierarchy');
const isolatedBox = byId<HTMLInputElement>('isolated');
const dbColorsBox = byId<HTMLInputElement>('db-colors');
const localBox = byId<HTMLInputElement>('local');
const localDepth = byId<HTMLSelectElement>('local-depth');
const viewToggle = byId<HTMLButtonElement>('view-toggle');
const notice = byId('notice');
const ZOOM_STEP = 1.5;
const EMPTY_TEXT = '아직 그릴 연결이 없어요. 설정에서 토큰을 넣고 "연결 지도 만들기"를 눌러 주세요.';
const FILTERED_TEXT = '모든 종류를 숨겼어요. 위의 점 종류 버튼을 눌러 다시 보이게 하세요.';

let view: GraphView | undefined;
let rawPages: PageRecord[] = [];
let rawLinks: RawLink[] = [];
let hidden: KindFilter = SHOW_ALL;
// fullGraph = 필터만 적용한 전체(검색·목록·받은·보낸 연결의 기준), lastGraph = 실제로 그리는 것(주변만 보기면 일부)
let fullGraph: GraphData = { nodes: [], links: [] };
let lastGraph: GraphData = fullGraph;
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

function openById(id: string): void {
  if (demo) {
    notice.textContent = '예시 페이지라 Notion에서 열 수 없어요. "내 연결 지도로 돌아가기"를 누르면 내 페이지를 볼 수 있어요.';
    return;
  }
  void openPage(mode, pageUrl(id, pagesById.get(id)?.url)).catch((error: unknown) => {
    notice.textContent = `페이지를 열지 못했어요: ${error instanceof Error ? error.message : String(error)}`;
  });
}

// 키보드 사용자가 검색으로 고른 페이지를 열 수 있게 선택 막대를 보여 주고 "Notion에서 열기"로 초점을 옮긴다(WCAG 2.1.1)
function select(id: string | null): void {
  // 사용자가 직접 고르거나 풀면, 나중에 색인된 지금 페이지가 그 선택을 덮어쓰지 않게 한다
  pickCurrent = false;
  selectedId = id;
  renderSelection();
  const picked = id !== null && rowsById.has(id);
  if (localBox.checked) {
    // 주변만 볼 때는 고른 페이지가 새 중심이라 그릴 점이 바뀐다. 작은 그래프라 옮기지 않고 전체를 맞춘다(풀면 전체 그래프를 맞춘다)
    autoFit = true;
    refreshView();
  } else if (picked) {
    autoFit = false;
    view?.focusNode(id);
  } else if (view) applyFocus(view);
  if (picked) byId('sel-open').focus();
}

const localCenter = (): string | null => (localBox.checked && selectedId !== null && rowsById.has(selectedId) ? selectedId : null);

function renderSelection(): void {
  const row = selectedId === null ? undefined : rowsById.get(selectedId);
  byId('selection').hidden = row === undefined;
  byId('sel-title').textContent = row?.title ?? '';
  renderLinks(row ? linkedPages(fullGraph, row.id) : undefined, select);
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
  applyFocus(target);
}

// 화면 이동: 주변만 볼 때는 전체 맞춤, 아니면 지금 페이지로 처음 한 번 옮겨 가고 그 뒤로는 자동 맞춤을 따른다.
// 강조: 선택한 페이지, 없으면 지금 페이지(강조만 바꿀 때는 화면을 움직이지 않는다)
function applyFocus(target: GraphView): void {
  const drawn = (id: string | null): id is string => id !== null && lastGraph.nodes.some((node) => node.id === id);
  if (localCenter() !== null) {
    // 주변만 보기를 끄거나 풀 때 지금 페이지로 날아가지 않게, 옮겨 간 것으로 친다
    focusApplied = true;
    target.fit();
  } else if (drawn(focusId) && !focusApplied) {
    target.focusNode(focusId);
    focusApplied = true;
    autoFit = false;
  } else if (autoFit) target.fit();
  target.focusNode(drawn(selectedId) ? selectedId : drawn(focusId) ? focusId : null, false);
}

const drawnGraph = (): GraphData => {
  const center = localCenter();
  return center === null ? fullGraph : localSubgraph(fullGraph, center, Number(localDepth.value));
};

// 주변만 켰는데 고른 페이지가 없으면 전체가 그려지므로 그 이유를 알린다
function renderLocalControls(): void {
  localDepth.disabled = !localBox.checked;
  byId('local-hint').hidden = !localBox.checked || localCenter() !== null;
}

// 저장소·필터는 그대로 두고 그릴 점(주변만 보기면 일부)만 다시 정한다. 바뀌지 않았으면 강조·화면만 고친다
function refreshView(): void {
  const next = drawnGraph();
  const changed = next !== lastGraph;
  lastGraph = next;
  renderEmpty();
  renderLocalControls();
  const target = ensureView();
  if (!target) return;
  if (changed) applyData(target);
  else applyFocus(target);
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
  // 옆 패널처럼 그래프를 늦게 만들면 그 전에 정한 DB별 색을 넘긴다
  view.setGroupColors(groupColors);
  return view;
}

// 범례로 모든 종류를 숨겨 점이 없을 때는 설정 안내 대신 숨김을 푸는 방법을 알려 준다
function renderEmpty(): void {
  const filteredOut = lastGraph.nodes.length === 0 && rawPages.length > 0 && (hidden.page || hidden.dbItem || hidden.unreadable);
  byId('empty').hidden = lastGraph.nodes.length > 0;
  byId('empty-text').textContent = filteredOut ? FILTERED_TEXT : EMPTY_TEXT;
  byId('empty-settings').hidden = filteredOut;
  byId('empty-demo').hidden = filteredOut || demo;
}

// 저장소를 다시 읽지 않고, 하위 페이지 스위치·범례 필터만 바꿔 다시 그린다
function rebuild(): void {
  const filtered = applyFilters(buildGraph(rawPages, rawLinks, { hierarchy: hierarchyBox.checked }), hidden);
  // 지금 페이지와 선택한 페이지는 외톨이여도 남긴다(숨기면 찾을 수도, 따라갈 수도 없다)
  fullGraph = isolatedBox.checked ? hideIsolated(filtered, [focusId, selectedId]) : filtered;
  applyDatabaseColors();
  rows = buildRows(fullGraph);
  rowsById = new Map(rows.map((row) => [row.id, row]));
  // 숨겨진 목록은 다시 그리지 않고, 보일 때 그린다
  if (listMode) list.setRows(rows);
  search.setItems(fullGraph.nodes.filter((node) => !node.unreadable));
  if (pickCurrent && focusId !== null && rowsById.has(focusId)) {
    pickCurrent = false;
    selectedId = focusId;
  }
  if (selectedId !== null && !rowsById.has(selectedId)) selectedId = null;
  lastGraph = drawnGraph();
  renderEmpty();
  renderLocalControls();
  renderSelection();
  const target = ensureView();
  if (target) applyData(target);
}

const status = createStatusLine();
const reloader = createReloader({
  read: () => Promise.all([store.listPages(), store.allLinks()]),
  onData: (pages, links) => {
    rawPages = pages;
    rawLinks = links;
    pagesById = new Map(pages.map((page) => [page.id, page]));
    rebuild();
  },
  onError: (error) => {
    notice.textContent = `저장된 연결 지도를 읽지 못했어요: ${error instanceof Error ? error.message : String(error)}`;
  },
});

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

for (const id of ['open-settings', 'empty-settings']) byId(id).addEventListener('click', () => void chrome.runtime.openOptionsPage());
byId('sel-open').addEventListener('click', () => {
  if (selectedId !== null) openById(selectedId);
});
byId('sel-clear').addEventListener('click', () => {
  select(null);
  byId('search').focus();
});
hierarchyBox.addEventListener('change', rebuild);
isolatedBox.addEventListener('change', rebuild);

// DB별 색: 이름은 지도를 다 만들 때 서비스 워커가 저장한다. 처음 알게 된 순서대로 색을 줘서 새 DB가 생겨도 기존 색은 그대로다
let databaseNames: Record<string, string> = {};
let databaseNamesError: string | undefined;
let groupColors: Map<string, string> | null = null;
// 지금 그래프에 있는 DB끼리만 색 순서를 매긴다(지워진 DB가 색 칸을 차지하지 않게). 순서는 처음 알게 된 순서
function applyDatabaseColors(): void {
  const present = new Set(fullGraph.nodes.flatMap((node) => (node.group ? [node.group] : [])));
  const names = Object.fromEntries(Object.entries(databaseNames).filter(([id]) => present.has(id)));
  groupColors = renderDatabaseLegend(byId('db-legend'), dbColorsBox.checked ? { names, error: databaseNamesError } : null, palette);
  view?.setGroupColors(groupColors);
}
dbColorsBox.addEventListener('change', applyDatabaseColors);
if (!demo) chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || (!changes.databaseNames && !changes.databaseNamesError)) return;
  if (changes.databaseNames) databaseNames = (changes.databaseNames.newValue as Record<string, string> | undefined) ?? {};
  if (changes.databaseNamesError) databaseNamesError = changes.databaseNamesError.newValue as string | undefined;
  applyDatabaseColors();
});
for (const control of [localBox, localDepth]) {
  control.addEventListener('change', () => {
    autoFit = true;
    refreshView();
  });
}

new ResizeObserver(() => {
  const created = view === undefined;
  const target = ensureView();
  if (!target) return;
  target.resize(container.clientWidth, container.clientHeight);
  if (created) applyData(target);
  else if (autoFit) target.fit();
}).observe(container);

if (!demo) chrome.storage.onChanged.addListener((changes, area) => {
  const progress = changes.progress?.newValue as Progress | undefined;
  if (area === 'local' && progress) {
    status.setProgress(progress);
    reloader.schedule(progress.phase === 'running');
  }
  if (tokenChanged(changes, area)) {
    void tokenPresent().then(status.setHasToken);
  }
  const pageId: unknown = changes.focusPageId?.newValue;
  if (area === 'session' && changes.focusPageId) setCurrentPage(typeof pageId === 'string' ? pageId : null);
});

// 지금 페이지가 바뀌면(아이콘 클릭·옆 패널 따라가기) 그래프를 다시 짜지 않고 강조와 선택만 바꾼다
function setCurrentPage(id: string | null): void {
  focusId = id;
  focusApplied = false;
  // 강조할 페이지가 없어지면 다시 전체가 보이게 맞춘다
  if (id === null) autoFit = true;
  view?.focusNode(null);
  // 색인에 아직 없는 페이지면 이전 페이지의 연결이 지금 페이지 것처럼 남지 않게 선택을 풀고, 색인되면 고른다
  pickCurrent = id !== null && !rowsById.has(id);
  if (id !== null) selectedId = rowsById.has(id) ? id : null;
  renderSelection();
  // 주변만 볼 때는 중심이 바뀌어 그릴 점이 달라진다
  if (localBox.checked) autoFit = true;
  refreshView();
}

if (mode === 'side' && !demo) {
  followTabs((pageId, tabId) => {
    if (pageId === focusId) return;
    setCurrentPage(pageId);
    // 가운데 창으로 바꿀 때 쓸 Notion 탭도 지금 따라간 탭으로 맞춘다
    chrome.storage.session.set({ originTabId: tabId }).catch((error: unknown) => {
      notice.textContent = `지금 탭을 기억하지 못했어요: ${error instanceof Error ? error.message : String(error)}`;
    });
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && mode === 'center') {
    void chrome.runtime.sendMessage({ type: 'close-overlay' } satisfies Message);
  }
});

async function init(): Promise<void> {
  if (demo) {
    showDemo();
    return;
  }
  const [local, session, present] = await Promise.all([
    chrome.storage.local.get(['progress', 'databaseNames', 'databaseNamesError']),
    chrome.storage.session.get('focusPageId'),
    tokenPresent(),
  ]);
  status.setHasToken(present);
  databaseNames = (local.databaseNames as Record<string, string> | undefined) ?? {};
  databaseNamesError = local.databaseNamesError as string | undefined;
  status.setProgress((local.progress as Progress | undefined) ?? IDLE_PROGRESS);
  focusId = typeof session.focusPageId === 'string' ? session.focusPageId : null;
  pickCurrent = focusId !== null;
  await reloader.reload();
}

function showDemo(): void {
  const sample = demoData();
  rawPages = sample.pages;
  rawLinks = sample.links;
  pagesById = new Map(sample.pages.map((page) => [page.id, page]));
  databaseNames = sample.databaseNames;
  databaseNamesError = undefined;
  byId('demo-banner').hidden = false;
  // 예시를 보는 동안 내 연결 지도의 상태·버튼은 헷갈리므로 숨긴다
  byId('status-row').hidden = true;
  rebuild();
}

function leaveDemo(): void {
  params.delete('demo');
  location.search = params.toString();
}

byId('demo-exit').addEventListener('click', leaveDemo);
setupExport(
  {
    graph: () => fullGraph,
    rows: () => rows,
    pages: () => pagesById,
    databaseNames: () => databaseNames,
    // 예시 페이지는 실제 노션 주소가 없다
    urlOf: (id) => (demo ? '' : pageUrl(id, pagesById.get(id)?.url)),
    showingList: () => listMode,
    background: palette.background,
    demo: () => demo,
  },
  notice,
);
byId('empty-demo').addEventListener('click', () => void openDemoTab());

void init();
