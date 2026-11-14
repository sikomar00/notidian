import '../ui.css';
import './graph.css';
import { localSubgraph, SHOW_ALL } from '../../graph/filter.ts';
import type { KindFilter } from '../../graph/filter.ts';
import { demoData } from '../../graph/demoData.ts';
import { linkedPages } from '../../graph/rows.ts';
import { visibleGraph } from '../../graph/visibleGraph.ts';
import type { NodeRow } from '../../graph/rows.ts';
import type { GraphData, LinkEvidence, PageRecord, RawLink } from '../../graph/types.ts';
import { pageUrl } from '../../notion/urlToPageId.ts';
import { openIdbStore } from '../background/idbStore.ts';
import { byId } from '../dom.ts';
import { isViewMode } from '../messages.ts';
import type { Message, ViewMode } from '../messages.ts';
import { renderLinks } from './linksPanel.ts';
import { createMentionsController } from './mentionsController.ts';
import { createPathPanel } from './pathPanel.ts';
import { createLinkTooltip } from './linkTooltip.ts';
import { createColorsController } from './colorsController.ts';
import { setupResurface } from './resurfacePanel.ts';
import { timeAgo } from '../progressText.ts';
import { followTabs } from './follow.ts';
import { createListView } from './listview.ts';
import { openDemoTab } from '../containers.ts';
import { openPage } from './navigate.ts';
import { setupToolbar } from './toolbar.ts';
import { loadSaved, watchStorage } from './startup.ts';
import type { Shown } from './toolbar.ts';
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
// shortcut: 화면을 연 채 시스템 테마가 바뀌면 다시 연다(선택·확대가 풀린다). 그래프 색을 그 자리에서 바꾸려면 render에 팔레트 교체를 넣는다
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => location.reload());

const store = openIdbStore();
const container = byId('graph');
const hierarchyBox = byId<HTMLInputElement>('hierarchy');
const isolatedBox = byId<HTMLInputElement>('isolated');
const localBox = byId<HTMLInputElement>('local');
const localDepth = byId<HTMLSelectElement>('local-depth');
const notice = byId('notice');
const EMPTY_TEXT = '아직 그릴 연결이 없어요. 설정에서 토큰을 넣고 "연결 지도 만들기"를 눌러 주세요.';
const FILTERED_TEXT = '모든 종류를 숨겼어요. 위의 점 종류 버튼을 눌러 다시 보이게 하세요.';

let view: GraphView | undefined;
let rawPages: PageRecord[] = [];
let rawLinks: RawLink[] = [];
let hidden: KindFilter = SHOW_ALL;
// fullGraph = 필터만 적용한 전체(검색·목록·받은·보낸 연결의 기준), lastGraph = 실제로 그리는 것(주변만 보기면 일부)
let fullGraph: GraphData = { nodes: [], links: [] };
// 범례만 적용한 읽을 수 있는 페이지(언급 정리 대상). 외톨이 숨기기는 빼지 않는다
let kindVisible: ReadonlySet<string> = new Set();
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
let shown: Shown = 'graph';

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

// 연결 안 된 언급(S2-7)·언급 정리(S2-8): 예시 모드는 가짜 본문, 아니면 저장된 본문 글자
// 연결 근거(F-28): `from\u0000to` → 근거. 저장된 지도를 다시 읽을 때 새로 만든다
let evidenceByKey = new Map<string, LinkEvidence | undefined>();
const evidenceOf = (from: string, to: string): LinkEvidence | undefined => evidenceByKey.get(`${from}\u0000${to}`);
function setData(pages: PageRecord[], links: RawLink[]): void {
  rawPages = pages;
  pagesById = new Map(pages.map((page) => [page.id, page]));
  rawLinks = links;
  evidenceByKey = new Map(links.map((link) => [`${link.from}\u0000${link.to}`, link.evidence]));
}
// 점 색: DB별 색과 색 그룹(F-35)
const colors = createColorsController({
  demo,
  palette,
  notice,
  graph: () => fullGraph,
  pages: () => pagesById,
  view: () => view,
  redrawSelection: () => renderSelection(),
});
// 선 위 근거 말풍선(F-33)
const linkTooltip = createLinkTooltip(byId('graph-area'), { titleOf: (id) => rowsById.get(id)?.title ?? id, evidenceOf });
// 경로 찾기(F-31): 고른 페이지에서 다른 페이지까지
let currentPath: string[] | null = null;
const paths = createPathPanel({
  graph: () => fullGraph,
  titleOf: (id) => rowsById.get(id)?.title ?? id,
  hasLink: (from, to) => evidenceByKey.has(`${from}\u0000${to}`),
  evidenceOf,
  drawn: (id) => lastGraph.nodes.some((node) => node.id === id),
  onPath: (ids) => {
    // 그래프가 아직 없으면(목록 보기로 열었을 때) 기억해 두었다가 그래프를 만들 때 넘긴다
    currentPath = ids;
    view?.setPath(ids);
  },
});

const mentions = createMentionsController({
  demo,
  loadTexts: demo ? async () => demoData().texts : () => store.listTexts(),
  onOpen: openById,
  notice,
  data: () => ({ pagesById, links: rawLinks, visible: kindVisible }),
  redrawSelection: () => renderSelection(),
});

function renderSelection(): void {
  const row = selectedId === null ? undefined : rowsById.get(selectedId);
  byId('selection').hidden = row === undefined;
  byId('sel-title').textContent = row?.title ?? '';
  // 색만으로 구분하지 않도록 색 그룹을 글자로 적고(F-37), 오래 안 고친 페이지인지 보이게 마지막 수정도 적는다(F-38)
  const group = row ? colors.groupOf(row.id) : undefined;
  const edited = Date.parse(row ? (pagesById.get(row.id)?.lastEdited ?? '') : '');
  byId('sel-meta').textContent = [group && `그룹: ${group}`, Number.isFinite(edited) && `마지막 수정: ${timeAgo(edited, Date.now())}`].filter(Boolean).join(' · ');
  renderLinks(row ? linkedPages(fullGraph, row.id) : undefined, select, (other, direction) =>
    row ? (direction === 'in' ? evidenceOf(other, row.id) : evidenceOf(row.id, other)) : undefined,
  );
  paths.setSource(row && !row.unreadable ? row.id : null);
  mentions.drawer(row && !row.unreadable ? { id: row.id, title: pagesById.get(row.id)?.title ?? row.title } : undefined);
}

const searchInput = byId<HTMLInputElement>('search');
const search = setupSearch({ input: searchInput, list: byId<HTMLUListElement>('search-list'), live: byId('live') }, (id) => {
  // 후보를 고르면 검색창 값이 코드로 바뀌어 input 이벤트가 나지 않으므로 목록 검색어도 직접 맞춘다
  list.setQuery(searchInput.value);
  select(id);
});
const list = createListView(byId<HTMLTableSectionElement>('list-body'), byId('list-note'), openById);

function applyData(target: GraphView): void {
  // 다시 그리면 마우스를 올려 둔 선이 바뀌거나 사라질 수 있어 말풍선을 닫는다(다음 움직임에 다시 판정)
  linkTooltip.hide();
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
  // 주변만 보기가 바뀌면 그래프에 그려지는 길도 달라진다
  paths.refresh();
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
    onLinkHover: (link, point) => (link ? linkTooltip.show(link, point) : linkTooltip.hide()),
  });
  // 옆 패널처럼 그래프를 늦게 만들면 그 전에 정한 DB별 색과 찾아 둔 경로를 넘긴다
  colors.applyTo(view);
  view.setPath(currentPath);
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
  ({ graph: fullGraph, kindVisible, rows } = visibleGraph(rawPages, rawLinks, {
    hierarchy: hierarchyBox.checked,
    hidden,
    hideIsolated: isolatedBox.checked,
    keep: [focusId, selectedId],
  }));
  colors.rebuilt();
  rowsById = new Map(rows.map((row) => [row.id, row]));
  // 숨겨진 목록은 다시 그리지 않고, 보일 때 그린다
  if (shown === 'list') list.setRows(rows);
  mentions.rebuilt();
  const readable = fullGraph.nodes.filter((node) => !node.unreadable);
  search.setItems(readable);
  paths.setItems(readable);
  if (pickCurrent && focusId !== null && rowsById.has(focusId)) {
    pickCurrent = false;
    selectedId = focusId;
  }
  if (selectedId !== null && !rowsById.has(selectedId)) selectedId = null;
  lastGraph = drawnGraph();
  // 범례·보기 옵션·새 데이터로 그래프가 바뀌면 찾아 둔 경로도 다시 구한다
  paths.refresh();
  renderEmpty();
  renderLocalControls();
  renderSelection();
  const target = ensureView();
  if (target) applyData(target);
}

// [그래프|목록|언급 정리] 전환
function showView(next: Shown): void {
  if (next === shown) return;
  shown = next;
  markView(next);
  byId('graph-area').hidden = next !== 'graph';
  if (next !== 'graph') linkTooltip.hide();
  byId('list-view').hidden = next !== 'list';
  byId('cleanup-view').hidden = next !== 'cleanup';
  if (next === 'list') list.setRows(rows);
  mentions.setCleanupShown(next === 'cleanup');
}
const markView = setupToolbar({
  mode,
  notice,
  container,
  view: () => view,
  setAutoFit: (on) => (autoFit = on),
  toggleKind: (kind) => {
    hidden = { ...hidden, [kind]: !hidden[kind] };
    return !hidden[kind];
  },
  rebuild,
  showView,
});

const status = createStatusLine();
const reloader = createReloader({
  read: () => Promise.all([store.listPages(), store.allLinks()]),
  onData: (pages, links) => {
    setData(pages, links);
    // 제목이 바뀌었을 수 있어 본문 글자도 다시 준비한다
    mentions.dataReloaded();
    rebuild();
  },
  onError: (error) => {
    notice.textContent = `저장된 연결 지도를 읽지 못했어요: ${error instanceof Error ? error.message : String(error)}`;
  },
});

byId<HTMLInputElement>('search').addEventListener('input', (event) => {
  list.setQuery((event.target as HTMLInputElement).value);
});

byId('sel-open').addEventListener('click', () => {
  if (selectedId !== null) openById(selectedId);
});
byId('sel-clear').addEventListener('click', () => {
  select(null);
  byId('search').focus();
});
hierarchyBox.addEventListener('change', rebuild);
isolatedBox.addEventListener('change', rebuild);

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

if (!demo) watchStorage({ status, reloader, mentions }, (id) => setCurrentPage(id));

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
  focusId = await loadSaved({ status, mentions, colors });
  pickCurrent = focusId !== null;
  await reloader.reload();
}

function showDemo(): void {
  const sample = demoData();
  setData(sample.pages, sample.links);
  colors.setDatabaseNames(sample.databaseNames, undefined);
  byId('demo-banner').hidden = false;
  // 예시를 보는 동안 내 연결 지도의 상태·버튼은 헷갈리므로 숨긴다(다시 볼 페이지는 예시에서도 쓴다)
  for (const id of ['status', 'reindex']) byId(id).hidden = true;
  rebuild();
}

function leaveDemo(): void {
  params.delete('demo');
  location.search = params.toString();
}

byId('demo-exit').addEventListener('click', leaveDemo);
// 다시 볼 페이지(F-38): 꺼낸 페이지는 고른 것처럼 가운데로 옮기고 패널을 연다
// 키보드로 "다른 페이지"를 거듭 누를 수 있게 초점은 버튼에 두고, 꺼낸 페이지는 화면 읽기 프로그램에 알린다
setupResurface(() => rows, () => pagesById, (id) => {
  select(id);
  byId('resurface').focus();
  byId('live').textContent = `꺼낸 페이지: ${rowsById.get(id)?.title ?? ''}`;
});
setupExport(
  {
    graph: () => fullGraph,
    rows: () => rows,
    pages: () => pagesById,
    databaseNames: () => colors.databaseNames(),
    // 예시 페이지는 실제 노션 주소가 없다
    urlOf: (id) => (demo ? '' : pageUrl(id, pagesById.get(id)?.url)),
    // 목록·언급 정리를 보는 동안은 그래프가 가려져 그림을 저장하지 않는다
    graphHidden: () => shown !== 'graph',
    background: palette.background,
    demo: () => demo,
  },
  notice,
);
byId('empty-demo').addEventListener('click', () => void openDemoTab());

void init();
