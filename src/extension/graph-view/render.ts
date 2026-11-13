import ForceGraph from 'force-graph';
import { neighborMap } from '../../graph/neighbors.ts';
import type { GraphData, GraphLink, GraphNode } from '../../graph/types.ts';
import type { Palette } from './palette.ts';

type ViewNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number };
type ViewGraph = ForceGraph<ViewNode, GraphLink>;

export interface GraphView {
  setData(data: GraphData): void;
  /** 그 점을 강조하고 가운데로 옮긴다. 그래프에 아직 없는 점이면 false(강조는 점이 생길 때 나타난다). */
  focusNode(id: string | null): boolean;
  /** 모든 점이 화면에 들어오게 맞춘다. 점 좌표가 생길 때까지 잠깐 기다린다. */
  fit(): void;
  zoomBy(factor: number): void;
  resize(width: number, height: number): void;
}

interface ViewState {
  palette: Palette;
  hoverId: string | null;
  focusId: string | null;
  hubIds: Set<string>;
  neighbors: Map<string, Set<string>>;
  nodes: Map<string, ViewNode>;
}

const LABEL_ZOOM = 1.6;
const ARROW_LENGTH = 6;
const WARMUP_TICKS = 80;
const FOCUS_ZOOM = 3;
const REDRAW_MS = 500;
const HIERARCHY_DASH = [4, 3];
// 확대하지 않아도 이름을 보여 줄 허브 점 수(연결 2개 이상인 점 중 많은 순)
const HUB_LABELS = 8;
// 확대 버튼·휠·전체 보기가 같은 범위를 쓰도록 그래프에도 지정한다
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 12;
const PLACE_ATTEMPTS = 20;
const GRAVITY = 0.04;

const radiusOf = (node: GraphNode): number => 4 + Math.sqrt(node.degree) * 2;
const idOf = (end: unknown): string => (typeof end === 'object' && end !== null ? (end as { id: string }).id : String(end));

function isRelated(state: ViewState, id: string): boolean {
  if (state.hoverId === null) return true;
  return id === state.hoverId || state.neighbors.get(state.hoverId)?.has(id) === true;
}

function isActive(state: ViewState, link: GraphLink): boolean {
  return state.hoverId !== null && (idOf(link.source) === state.hoverId || idOf(link.target) === state.hoverId);
}

// 그래프 좌표 (x, y)에 가장 가까운 점. 점 가장자리에서 2만큼 여유를 둔다
function nodeAt(state: ViewState, x: number, y: number): ViewNode | undefined {
  let nearest: ViewNode | undefined;
  let nearestGap = Infinity;
  for (const node of state.nodes.values()) {
    if (node.x === undefined || node.y === undefined) continue;
    const gap = Math.hypot(node.x - x, node.y - y) - radiusOf(node);
    if (gap <= 2 && gap < nearestGap) {
      nearest = node;
      nearestGap = gap;
    }
  }
  return nearest;
}

function traceShape(ctx: CanvasRenderingContext2D, node: ViewNode, radius: number): void {
  const [x, y] = [node.x ?? 0, node.y ?? 0];
  ctx.beginPath();
  if (node.kind === 'dbItem') ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
  else ctx.arc(x, y, radius, 0, 2 * Math.PI);
}

function fillShape(ctx: CanvasRenderingContext2D, node: ViewNode, radius: number): void {
  traceShape(ctx, node, radius);
  ctx.fill();
}

function drawNode(state: ViewState, node: ViewNode, ctx: CanvasRenderingContext2D, scale: number): void {
  const { palette } = state;
  const radius = radiusOf(node);
  ctx.globalAlpha = isRelated(state, node.id) ? 1 : 0.25;
  if (node.unreadable) {
    // 읽을 수 없는 페이지는 색만으로 구분하지 않도록 속이 빈 점선 테두리로 그린다(WCAG 1.4.1)
    ctx.setLineDash([3 / scale, 2 / scale]);
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = palette.unreadable;
    traceShape(ctx, node, radius);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    ctx.fillStyle = node.kind === 'dbItem' ? palette.dbItem : palette.page;
    fillShape(ctx, node, radius);
  }
  if (node.id === state.focusId) {
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = palette.focus;
    ctx.strokeRect((node.x ?? 0) - radius - 3, (node.y ?? 0) - radius - 3, (radius + 3) * 2, (radius + 3) * 2);
  }
  const emphasized =
    node.id === state.focusId || state.hubIds.has(node.id) || (state.hoverId !== null && isRelated(state, node.id));
  if (scale > LABEL_ZOOM || emphasized) {
    ctx.font = `${12 / scale}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = palette.text;
    ctx.fillText(node.title, node.x ?? 0, (node.y ?? 0) + radius + 11 / scale);
  }
  ctx.globalAlpha = 1;
}

// 화살표가 도착하는 점의 가장자리에 놓이도록 선 위의 비율을 구한다
function arrowRelPos(state: ViewState, link: GraphLink): number {
  const source = state.nodes.get(idOf(link.source));
  const target = state.nodes.get(idOf(link.target));
  if (source?.x === undefined || source.y === undefined || target?.x === undefined || target.y === undefined) return 1;
  const length = Math.hypot(target.x - source.x, target.y - source.y);
  return length === 0 ? 1 : Math.max(0.5, 1 - (radiusOf(target) + ARROW_LENGTH / 2 + 1) / length);
}

// 양쪽으로 이어진 선은 출발 쪽에도 화살표를 그린다
function drawBackArrow(state: ViewState, link: GraphLink, ctx: CanvasRenderingContext2D): void {
  if (!link.bidirectional || !isActive(state, link)) return;
  const source = state.nodes.get(idOf(link.source));
  const target = state.nodes.get(idOf(link.target));
  if (source?.x === undefined || source.y === undefined || target?.x === undefined || target.y === undefined) return;
  const length = Math.hypot(target.x - source.x, target.y - source.y);
  if (length === 0) return;
  const [ux, uy] = [(source.x - target.x) / length, (source.y - target.y) / length];
  const reach = radiusOf(source) + 1;
  const [tipX, tipY] = [source.x - ux * reach, source.y - uy * reach];
  ctx.fillStyle = state.palette.linkActive;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * ARROW_LENGTH - uy * ARROW_LENGTH * 0.4, tipY - uy * ARROW_LENGTH + ux * ARROW_LENGTH * 0.4);
  ctx.lineTo(tipX - ux * ARROW_LENGTH + uy * ARROW_LENGTH * 0.4, tipY - uy * ARROW_LENGTH - ux * ARROW_LENGTH * 0.4);
  ctx.fill();
}

// 계층 선은 연결이 아니므로 점선으로 구분하고 방향 화살표를 그리지 않는다
function configureGraph(container: HTMLElement, state: ViewState, onNodeClick: (node: GraphNode) => void): ViewGraph {
  return new ForceGraph<ViewNode, GraphLink>(container)
    .backgroundColor(state.palette.background)
    .minZoom(MIN_ZOOM)
    .maxZoom(MAX_ZOOM)
    .nodeLabel(() => '')
    .nodeCanvasObject((node, ctx, scale) => drawNode(state, node, ctx, scale))
    .nodePointerAreaPaint((node, color, ctx) => {
      ctx.fillStyle = color;
      fillShape(ctx, node, radiusOf(node) + 2);
    })
    .linkColor((link) => (isActive(state, link) ? state.palette.linkActive : state.palette.link))
    .linkWidth((link) => (isActive(state, link) ? 2.2 : 1.1))
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

// force-graph의 호버 이벤트는 마우스가 그래프 밖으로 나갈 때 해제를 알리지 않고, 같은 점으로 돌아오면 다시 알리지도 않는다.
// 그래서 호버는 공개 좌표 변환으로 직접 판정한다
function setupHover(
  container: HTMLElement,
  toGraph: (x: number, y: number) => { x: number; y: number },
  state: ViewState,
  redraw: () => void,
): void {
  function hover(id: string | null): void {
    if (id === state.hoverId) return;
    state.hoverId = id;
    container.style.cursor = id === null ? '' : 'pointer';
    redraw();
  }
  container.addEventListener('mousemove', (event) => {
    const box = container.getBoundingClientRect();
    const point = toGraph(event.clientX - box.left, event.clientY - box.top);
    hover(nodeAt(state, point.x, point.y)?.id ?? null);
  });
  container.addEventListener('mouseleave', () => hover(null));
}

// 연결 없는 점은 밀려나 계속 멀어져서 전체 보기가 아주 작아진다. 모든 점을 원점(가운데)으로 약하게 당긴다
function gravity(strength: number): ((alpha: number) => void) & { initialize: (nodes: ViewNode[]) => void } {
  let nodes: ViewNode[] = [];
  const force = (alpha: number): void => {
    for (const node of nodes) {
      node.vx = (node.vx ?? 0) - (node.x ?? 0) * strength * alpha;
      node.vy = (node.vy ?? 0) - (node.y ?? 0) * strength * alpha;
    }
  };
  return Object.assign(force, { initialize: (next: ViewNode[]) => void (nodes = next) });
}

function hubsOf(nodes: readonly GraphNode[]): Set<string> {
  const hubs = nodes.filter((node) => node.degree >= 2).sort((a, b) => b.degree - a.degree).slice(0, HUB_LABELS);
  return new Set(hubs.map((node) => node.id));
}

function createController(graph: ViewGraph, state: ViewState, redraw: () => void): GraphView {
  let loaded = false;
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
      whenPlaced(placed, () => graph.zoomToFit(400, 40));
    },
    zoomBy(factor) {
      viewTicket += 1;
      graph.zoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, graph.zoom() * factor)), 250);
    },
    setData(data) {
      state.neighbors = neighborMap(data.links);
      state.hubIds = hubsOf(data.nodes);
      // 점이 움직이던 자리를 유지하려고 같은 ID의 점 객체를 재사용한다
      const nodes = data.nodes.map((incoming) => Object.assign(state.nodes.get(incoming.id) ?? {}, incoming) as ViewNode);
      state.nodes = new Map(nodes.map((node) => [node.id, node]));
      graph.warmupTicks(loaded ? 0 : WARMUP_TICKS);
      loaded = true;
      graph.graphData({ nodes, links: data.links.map((link) => ({ ...link })) });
      redraw();
    },
    focusNode(id) {
      state.focusId = id;
      viewTicket += 1;
      redraw();
      if (id === null || !state.nodes.has(id)) return false;
      centerOn(id);
      return true;
    },
    resize(width, height) {
      graph.width(width).height(height);
    },
  };
}

export function createGraphView(
  container: HTMLElement,
  palette: Palette,
  handlers: { onNodeClick: (node: GraphNode) => void; onSettled?: () => void },
): GraphView {
  const state: ViewState = { palette, hoverId: null, focusId: null, hubIds: new Set(), neighbors: new Map(), nodes: new Map() };
  const graph = configureGraph(container, state, (node) => handlers.onNodeClick(node));
  graph.d3Force('gravity', gravity(GRAVITY));
  if (handlers.onSettled) graph.onEngineStop(handlers.onSettled);
  const redraw = createRedrawScheduler(graph);
  setupHover(container, (x, y) => graph.screen2GraphCoords(x, y), state, redraw);
  return createController(graph, state, redraw);
}
