import ForceGraph from 'force-graph';
import { neighborMap } from '../../graph/neighbors.ts';
import type { GraphData, GraphLink, GraphNode } from '../../graph/types.ts';
import type { Segment } from './hitTest.ts';
import { setupHover } from './hover.ts';
import { pullFor } from './labels.ts';
import { ARROW_LENGTH, arrowRelPos, drawBackArrow, drawLabels, drawNode, fillShape } from './drawing.ts';
import { FOCUS_RING, idOf, isActive, nodeAt, radiusOf } from './viewState.ts';
import type { ViewNode, ViewState } from './viewState.ts';
import type { Palette } from './palette.ts';

type ViewGraph = ForceGraph<ViewNode, GraphLink>;

export interface GraphView {
  setData(data: GraphData): void;
  /** 그 점을 강조하고 가운데로 옮긴다. 그래프에 아직 없는 점이면 false(강조는 점이 생길 때 나타난다). */
  focusNode(id: string | null, move?: boolean): boolean;
  /** 모든 점이 화면에 들어오게 맞춘다. 점 좌표가 생길 때까지 잠깐 기다린다. */
  fit(): void;
  zoomBy(factor: number): void;
  resize(width: number, height: number): void;
  /** DB 항목을 DB별 색으로 칠한다(null이면 한 색). */
  setGroupColors(colors: Map<string, string> | null): void;
  /** 색 그룹(F-35): 점 ID → 색. DB별 색보다 먼저 쓴다. null이면 지운다 */
  setNodeColors(colors: ReadonlyMap<string, string> | null): void;
  /** 경로 찾기의 길(점 ID 차례)을 굵은 선과 이름표로 강조한다. null이면 지운다(F-31) */
  setPath(ids: readonly string[] | null): void;
}

const WARMUP_TICKS = 80;
const FOCUS_ZOOM = 3;
const REDRAW_MS = 500;
const HIERARCHY_DASH = [4, 3];
// 선 두께. 그리기 비용의 대부분이 선을 칠하는 일이라, 선이 많으면 가늘게 그린다(헤드리스 측정: 선 5,000개 약 18→53fps,
// 12,500개 약 5→12fps). 가는 선은 테두리가 흐려지므로 더 진한 색(palette.thinLink)을 쓴다. 0.5px는 진하게 해도
// 실제로 칠해진 픽셀 대비가 3:1에 못 미쳐(밝은 테마 2.96:1) 0.8px로 정했다(5.93:1, 어두운 7.46:1). 강조한 선은 늘 굵다
const LINK = 1.1;
const THIN_LINK = 0.8;
const THIN_LINKS_FROM = 2500;
// 확대하지 않아도 이름을 보여 줄 허브 점 수(연결 2개 이상인 점 중 많은 순)
const HUB_LABELS = 8;
// 확대 버튼·휠·전체 보기가 같은 범위를 쓰도록 그래프에도 지정한다
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 12;
const PLACE_ATTEMPTS = 20;
const FIT_MAX_ZOOM = 4;
const FIT_PADDING = 40;
const FIT_MS = 400;
const GRAVITY = 0.04;
const CHARGE_REACH = 250;
// 처음 배치 틱 수 × 점 수의 상한(500점이면 80틱, 2,000점이면 20틱)
const WARMUP_BUDGET = 40_000;
// force-graph 기본 선 길이(30)
const NEW_NODE_GAP = 30;
// force-graph 기본값은 멈춤 기준이 없어 늘 15초를 움직인다. d3 기본 기준(0.001)으로 멈추고 최대 10초로 줄인다
const ALPHA_MIN = 0.001;
const COOLDOWN_MS = 10_000;

// 계층 선은 연결이 아니므로 점선으로 구분하고 방향 화살표를 그리지 않는다
function configureGraph(container: HTMLElement, state: ViewState, onNodeClick: (node: GraphNode) => void): ViewGraph {
  return new ForceGraph<ViewNode, GraphLink>(container)
    .backgroundColor(state.palette.background)
    .minZoom(MIN_ZOOM)
    .maxZoom(MAX_ZOOM)
    .d3AlphaMin(ALPHA_MIN)
    .cooldownTime(COOLDOWN_MS)
    .nodeLabel(() => '')
    .nodeCanvasObject((node, ctx, scale) => drawNode(state, node, ctx, scale))
    .nodePointerAreaPaint((node, color, ctx) => {
      ctx.fillStyle = color;
      fillShape(ctx, node, radiusOf(node) + 2);
    })
    .linkColor((link) => (isActive(state, link) ? state.palette.linkActive : state.thinLinks ? state.palette.thinLink : state.palette.link))
    .linkWidth((link) => (isActive(state, link) ? 2.2 : state.thinLinks ? THIN_LINK : LINK))
    .linkLineDash((link) => (link.hierarchy ? HIERARCHY_DASH : null))
    .linkDirectionalArrowLength((link) => (isActive(state, link) && !link.hierarchy ? ARROW_LENGTH : 0))
    .linkDirectionalArrowRelPos((link) => arrowRelPos(state, link))
    .linkCanvasObjectMode(() => 'after')
    .linkCanvasObject((link, ctx) => drawBackArrow(state, link, ctx))
    .onNodeClick(onNodeClick);
}

// 멈춘 그래프는 다시 그리지 않아서, 강조가 바뀌는 동안만 잠깐 계속 그리게 한다
function createRedrawScheduler(graph: ViewGraph): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    graph.autoPauseRedraw(false);
    clearTimeout(timer);
    timer = setTimeout(() => graph.autoPauseRedraw(true), REDRAW_MS);
  };
}

// 지금 그린 선들의 양 끝. 선 위 근거 말풍선(F-33)의 선 찾기에 쓴다.
// force-graph가 선의 끝을 점 객체로 바꿔 두므로 점 표를 다시 찾지 않고 그 좌표를 바로 읽는다
function* segmentsOf(state: ViewState): Iterable<Segment<GraphLink>> {
  for (const link of state.links) {
    const [source, target] = [link.source as unknown as ViewNode | string, link.target as unknown as ViewNode | string];
    if (typeof source === 'string' || typeof target === 'string') continue;
    if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) continue;
    yield { item: link, x1: source.x, y1: source.y, x2: target.x, y2: target.y };
  }
}

// 연결 없는 점은 밀려나 계속 멀어져서 전체 보기가 아주 작아진다. 모든 점을 원점(가운데)으로 약하게 당긴다.
// 화면이 가로로 길면 세로로 더 세게 당겨 그래프가 화면 모양을 따라 퍼지게 한다(가운데 작은 덩어리로 몰리지 않게)
function gravity(strength: () => { x: number; y: number }): ((alpha: number) => void) & { initialize: (nodes: ViewNode[]) => void } {
  let nodes: ViewNode[] = [];
  const force = (alpha: number): void => {
    const { x, y } = strength();
    for (const node of nodes) {
      node.vx = (node.vx ?? 0) - (node.x ?? 0) * x * alpha;
      node.vy = (node.vy ?? 0) - (node.y ?? 0) * y * alpha;
    }
  };
  return Object.assign(force, { initialize: (next: ViewNode[]) => void (nodes = next) });
}

// 색인 중 새로 생긴 점을 원점이 아니라 이미 놓인 이웃에서 선 하나 길이만큼 떨어진 곳에서 출발시킨다(갱신 뒤 움직임 약 13% 감소).
// shortcut: force-graph가 데이터를 바꿀 때마다 배치 세기를 처음 값으로 되돌려 첫 1~2초는 전체가 움직인다.
// 공개 API로는 세기를 못 낮추고, 고정·감쇠는 측정해 보니 움직임을 미루기만 했다. 거슬린다는 의견이 나오면 라이브러리 교체·수정을 검토한다
function placeNearNeighbors(fresh: readonly ViewNode[], state: ViewState): void {
  for (const node of fresh) {
    const anchor = [...(state.neighbors.get(node.id) ?? [])].map((id) => state.nodes.get(id)).find((other) => other?.x !== undefined);
    if (anchor?.x === undefined || anchor.y === undefined) continue;
    const angle = Math.random() * 2 * Math.PI;
    const reach = radiusOf(anchor) + NEW_NODE_GAP;
    node.x = anchor.x + Math.cos(angle) * reach;
    node.y = anchor.y + Math.sin(angle) * reach;
  }
}

// 모든 점이 들어오게 맞춘다. 점이 몇 개뿐이면(주변만 보기 등) 지나치게 확대돼 점이 화면을 채우므로 배율에 상한을 둔다.
// 점 범위는 중심 좌표 기준이라 가장 큰 점의 반지름과 강조 테두리만큼 여유를 더한다(이름표는 화면 여백이 맡는다)
function fitView(graph: ViewGraph, state: ViewState): void {
  const box = graph.getGraphBbox() as { x: [number, number]; y: [number, number] } | null;
  if (!box) return;
  const margin = Math.max(0, ...[...state.nodes.values()].map(radiusOf)) + FOCUS_RING;
  const width = box.x[1] - box.x[0] + 2 * margin;
  const height = box.y[1] - box.y[0] + 2 * margin;
  const scale = Math.min(FIT_MAX_ZOOM, (graph.width() - 2 * FIT_PADDING) / width, (graph.height() - 2 * FIT_PADDING) / height);
  graph.centerAt((box.x[0] + box.x[1]) / 2, (box.y[0] + box.y[1]) / 2, FIT_MS).zoom(Math.max(MIN_ZOOM, scale), FIT_MS);
}

function hubsOf(nodes: readonly GraphNode[]): Set<string> {
  const hubs = nodes.filter((node) => node.degree >= 2).sort((a, b) => b.degree - a.degree).slice(0, HUB_LABELS);
  return new Set(hubs.map((node) => node.id));
}

function createController(graph: ViewGraph, state: ViewState, redraw: () => void): GraphView {
  let loaded = false;
  const known = new Map<string, ViewNode>();
  // 화면 이동(가운데 맞추기·전체 맞추기·확대) 요청마다 번호를 올려, 더 최근 요청이 있으면 이전 재시도는 그만둔다
  let viewTicket = 0;

  // 점 좌표는 시뮬레이션이 돈 뒤에야 생겨서, 생길 때까지 잠깐씩 기다린다
  function whenPlaced(ready: () => boolean, action: () => void): void {
    const ticket = ++viewTicket;
    let attemptsLeft = PLACE_ATTEMPTS;
    const attempt = (): void => {
      if (ticket !== viewTicket) return;
      if (ready()) action();
      else if (attemptsLeft-- > 0) setTimeout(attempt, 150);
    };
    attempt();
  }

  function centerOn(id: string): void {
    const node = state.nodes.get(id);
    whenPlaced(() => node?.x !== undefined && node.y !== undefined, () => {
      graph.centerAt(node?.x, node?.y, 500).zoom(FOCUS_ZOOM, 500);
    });
  }

  return {
    fit() {
      // 목록 보기로 숨겨진 동안(크기 0)에 맞추면 배율이 최소로 떨어지므로, 크기가 생길 때까지 기다린다
      const placed = (): boolean => graph.width() > 0 && [...state.nodes.values()].some((node) => node.x !== undefined);
      whenPlaced(placed, () => fitView(graph, state));
    },
    zoomBy(factor) {
      viewTicket += 1;
      graph.zoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, graph.zoom() * factor)), 250);
    },
    setData(data) {
      state.neighbors = neighborMap(data.links);
      state.hubIds = hubsOf(data.nodes);
      state.thinLinks = data.links.length > THIN_LINKS_FROM;
      // 점이 움직이던 자리를 유지하려고 같은 ID의 점 객체를 재사용한다. 주변만 보다가 돌아와도 전체 배치가 그대로이도록, 지금 안 그리는 점의 자리도 기억한다
      const fresh: ViewNode[] = [];
      const nodes = data.nodes.map((incoming) => {
        const previous = known.get(incoming.id);
        const node = Object.assign(previous ?? {}, incoming) as ViewNode;
        if (!previous) fresh.push(node);
        known.set(node.id, node);
        return node;
      });
      state.nodes = new Map(nodes.map((node) => [node.id, node]));
      if (loaded) placeNearNeighbors(fresh, state);
      // 처음 배치를 한 프레임에 몰아 하면 점이 많을 때 화면이 멈춰서(2,000점 약 0.6초), 점 수에 맞춰 줄인다
      graph.warmupTicks(loaded ? 0 : Math.min(WARMUP_TICKS, Math.round(WARMUP_BUDGET / Math.max(1, nodes.length))));
      loaded = true;
      state.links = data.links.map((link) => ({ ...link }));
      state.hoverLink = null;
      graph.graphData({ nodes, links: state.links });
      redraw();
    },
    focusNode(id, move = true) {
      state.focusId = id;
      redraw();
      // 강조만 바꿀 때는 기다리는 맞춤·이동을 취소하지 않는다
      if (!move) return id !== null && state.nodes.has(id);
      viewTicket += 1;
      if (id === null || !state.nodes.has(id)) return false;
      centerOn(id);
      return true;
    },
    setGroupColors(colors) {
      state.groupColors = colors;
      redraw();
    },
    setNodeColors(colors) {
      state.nodeColors = colors;
      redraw();
    },
    setPath(ids) {
      state.pathNodes = new Set(ids ?? []);
      state.pathLinks = new Set((ids ?? []).slice(1).flatMap((id, index) => {
        const previous = ids?.[index] ?? '';
        return [`${previous}\u0000${id}`, `${id}\u0000${previous}`];
      }));
      redraw();
    },
    resize(width, height) {
      graph.width(width).height(height);
      // 화면 모양에 맞춰 당기는 힘을 나눈다. 다음에 배치가 움직일 때부터 반영된다. 숨겨진 동안(크기 0)은 그대로 둔다
      state.pull = pullFor(width, height, GRAVITY) ?? state.pull;
    },
  };
}

export function createGraphView(
  container: HTMLElement,
  palette: Palette,
  handlers: {
    onNodeClick: (node: GraphNode) => void;
    onSettled?: () => void;
    /** 선에 마우스를 올렸을 때 그 선(끝은 점 ID)과 그래프 영역 안의 위치. 벗어나면 null */
    onLinkHover?: (link: GraphLink | null, point: { x: number; y: number }) => void;
  },
): GraphView {
  const state: ViewState = { palette, hoverId: null, focusId: null, hubIds: new Set(), neighbors: new Map(), nodes: new Map(), groupColors: null, thinLinks: false, pull: { x: GRAVITY, y: GRAVITY }, pathNodes: new Set(), pathLinks: new Set(), links: [], hoverLink: null, nodeColors: null };
  const graph = configureGraph(container, state, (node) => handlers.onNodeClick(node));
  graph.d3Force('gravity', gravity(() => state.pull));
  const hover = setupHover<GraphLink>(container, {
    toGraph: (x, y) => graph.screen2GraphCoords(x, y),
    zoom: () => graph.zoom(),
    nodeAt: (x, y, margin) => nodeAt(state, x, y, margin)?.id ?? null,
    segments: () => segmentsOf(state),
    onNode: (id) => {
      if (id === state.hoverId) return;
      state.hoverId = id;
      container.style.cursor = id === null ? '' : 'pointer';
      redraw();
    },
    onLink: (link, point) => {
      if (link !== state.hoverLink) {
        state.hoverLink = link;
        redraw();
      }
      handlers.onLinkHover?.(link && { ...link, source: idOf(link.source), target: idOf(link.target) }, point);
    },
  });
  graph.onRenderFramePost((ctx, scale) => {
    // 마우스가 가만히 있어도 확대·배치로 선이 움직였을 수 있어 마지막 위치로 다시 판정한다
    hover.recheck();
    const [topLeft, bottomRight] = [graph.screen2GraphCoords(0, 0), graph.screen2GraphCoords(graph.width(), graph.height())];
    drawLabels(state, ctx, { scale, left: topLeft.x, top: topLeft.y, right: bottomRight.x, bottom: bottomRight.y });
  });
  // 배치 계산의 대부분이 점끼리 밀어내는 힘이라(프로파일 2,000점 기준 약 65%), 먼 점끼리는 계산하지 않는다
  graph.d3Force('charge')?.distanceMax?.(CHARGE_REACH);
  if (handlers.onSettled) graph.onEngineStop(handlers.onSettled);
  const redraw = createRedrawScheduler(graph);
  return createController(graph, state, redraw);
}
