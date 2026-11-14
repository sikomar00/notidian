import type { GraphLink } from '../../graph/types.ts';
import { fitLabel, LABEL_PRIORITY, labelPriority, MAX_LABEL_WIDTH, pickLabels } from './labels.ts';
import type { LabelBox } from './labels.ts';
import { FOCUS_RING, idOf, isActive, isRelated, radiusOf } from './viewState.ts';
import type { ViewNode, ViewState } from './viewState.ts';

// 캔버스에 점·화살표·이름표를 그린다(force-graph의 그리기 갈고리에서 부른다)

const LABEL_ZOOM = 1.6;
// 한 화면에 놓는 이름표 수 상한. 겹침 검사가 개수의 제곱으로 늘고, 이보다 많으면 어차피 읽을 수 없다
const MAX_LABELS = 150;
const LABEL_FONT = "system-ui, 'Segoe UI', 'Malgun Gothic', sans-serif";
export const ARROW_LENGTH = 6;

function traceShape(ctx: CanvasRenderingContext2D, node: ViewNode, radius: number): void {
  const [x, y] = [node.x ?? 0, node.y ?? 0];
  ctx.beginPath();
  if (node.kind === 'dbItem') ctx.rect(x - radius, y - radius, radius * 2, radius * 2);
  else ctx.arc(x, y, radius, 0, 2 * Math.PI);
}

export function fillShape(ctx: CanvasRenderingContext2D, node: ViewNode, radius: number): void {
  traceShape(ctx, node, radius);
  ctx.fill();
}

function dbItemColor(state: ViewState, node: ViewNode): string {
  // 아직 이름을 모르는(지도를 다 만들기 전) DB는 기본 DB 색으로 둔다
  return state.groupColors?.get(node.group ?? '') ?? state.palette.dbItem;
}

export function drawNode(state: ViewState, node: ViewNode, ctx: CanvasRenderingContext2D, scale: number): void {
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
    ctx.fillStyle = state.nodeColors?.get(node.id) ?? (node.kind === 'page' ? palette.page : dbItemColor(state, node));
    fillShape(ctx, node, radius);
  }
  if (state.pathNodes.has(node.id) && node.id !== state.focusId) {
    // 경로 위의 점은 굵은 선과 같은 색 테두리로 표시한다
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = palette.linkActive;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, radius + FOCUS_RING, 0, 2 * Math.PI);
    ctx.stroke();
  }
  if (node.id === state.focusId) {
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = palette.focus;
    ctx.strokeRect((node.x ?? 0) - radius - FOCUS_RING, (node.y ?? 0) - radius - FOCUS_RING, (radius + FOCUS_RING) * 2, (radius + FOCUS_RING) * 2);
  }
  ctx.globalAlpha = 1;
}

interface Frame {
  scale: number;
  /** 보이는 범위(그래프 좌표) */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// 제목마다 12px 글자 폭과 말줄임한 글자를 한 번만 잰다(프레임마다 재면 점이 많을 때 느리다)
const labelCache = new Map<string, { text: string; width: number }>();
let measureContext: CanvasRenderingContext2D | null = null;
function labelOf(title: string): { text: string; width: number } {
  const known = labelCache.get(title);
  if (known) return known;
  measureContext ??= document.createElement('canvas').getContext('2d');
  if (!measureContext) return { text: title, width: title.length * 7 };
  measureContext.font = `12px ${LABEL_FONT}`;
  const fitted = fitLabel(title, (text) => measureContext?.measureText(text).width ?? text.length * 7);
  labelCache.set(title, fitted);
  return fitted;
}

function labelCandidates(state: ViewState, frame: Frame): LabelBox[] {
  const { scale } = frame;
  const height = 12 / scale;
  // 점이 화면 가장자리 바로 밖이어도 이름표 반쪽은 보일 수 있어 그만큼 넓게 본다
  const reachX = MAX_LABEL_WIDTH / 2 / scale;
  const reachY = 24 / scale;
  const candidates: LabelBox[] = [];
  for (const node of state.nodes.values()) {
    const [x, y] = [node.x, node.y];
    if (x === undefined || y === undefined) continue;
    if (x < frame.left - reachX || x > frame.right + reachX || y < frame.top - reachY || y > frame.bottom + reachY) continue;
    // 경로 위의 점은 이웃처럼 이름을 보여 준다
    const priority = state.pathNodes.has(node.id) ? Math.min(labelPriority(state, node.id), LABEL_PRIORITY.related) : labelPriority(state, node.id);
    if (priority === LABEL_PRIORITY.other && scale <= LABEL_ZOOM) continue;
    const { text, width: width12 } = labelOf(node.title);
    const width = width12 / scale;
    const always = priority <= LABEL_PRIORITY.hover;
    candidates.push({ id: node.id, text, x: x - width / 2, y: y + radiusOf(node) + 11 / scale - height, width, height: height * 1.25, priority, weight: node.degree, always });
  }
  return candidates;
}

/**
 * 점을 다 그린 뒤 이름표를 한꺼번에 놓는다. 중요한 것부터 놓고 겹치는 것은 건너뛰어(pickLabels) 이름이 서로 덮이지 않게 하고,
 * 둘레를 바탕색으로 한 번 그려 선 위에서도 읽히게 한다.
 */
export function drawLabels(state: ViewState, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const { scale } = frame;
  ctx.save();
  ctx.font = `${12 / scale}px ${LABEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3 / scale;
  ctx.strokeStyle = state.palette.background;
  ctx.fillStyle = state.palette.text;
  for (const label of pickLabels(labelCandidates(state, frame), MAX_LABELS)) {
    const [x, baseline] = [label.x + label.width / 2, label.y + 12 / scale];
    ctx.globalAlpha = isRelated(state, label.id) ? 1 : 0.25;
    ctx.strokeText(label.text, x, baseline);
    ctx.fillText(label.text, x, baseline);
  }
  ctx.restore();
}

// 화살표가 도착하는 점의 가장자리에 놓이도록 선 위의 비율을 구한다
export function arrowRelPos(state: ViewState, link: GraphLink): number {
  const source = state.nodes.get(idOf(link.source));
  const target = state.nodes.get(idOf(link.target));
  if (source?.x === undefined || source.y === undefined || target?.x === undefined || target.y === undefined) return 1;
  const length = Math.hypot(target.x - source.x, target.y - source.y);
  return length === 0 ? 1 : Math.max(0.5, 1 - (radiusOf(target) + ARROW_LENGTH / 2 + 1) / length);
}

// 양쪽으로 이어진 선은 출발 쪽에도 화살표를 그린다
export function drawBackArrow(state: ViewState, link: GraphLink, ctx: CanvasRenderingContext2D): void {
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
