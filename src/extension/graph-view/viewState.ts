import type { GraphLink, GraphNode } from '../../graph/types.ts';
import type { Palette } from './palette.ts';

// 그래프 그리기·호버·이름표가 함께 쓰는 화면 상태와 작은 도우미(render.ts·drawing.ts)

export type ViewNode = GraphNode & { x?: number; y?: number; vx?: number; vy?: number };

export interface ViewState {
  palette: Palette;
  hoverId: string | null;
  focusId: string | null;
  hubIds: Set<string>;
  neighbors: Map<string, Set<string>>;
  nodes: Map<string, ViewNode>;
  /** 선이 많을 때 선을 가늘게 그린다(그리기 비용의 대부분이 선을 칠하는 일이다) */
  thinLinks: boolean;
  /** DB별 색을 켰을 때 DB 번호 → 색. 꺼져 있으면 null(모든 DB 항목이 같은 색) */
  groupColors: Map<string, string> | null;
  /** 가운데로 당기는 힘(가로·세로). 화면 모양에 따라 바뀐다 */
  pull: { x: number; y: number };
  /** 경로 찾기의 길 위 점과 선(양쪽 방향 열쇠 `a\u0000b`) */
  pathNodes: Set<string>;
  pathLinks: Set<string>;
  /** 색 그룹으로 정한 점 색(없으면 종류·DB별 색) */
  nodeColors: ReadonlyMap<string, string> | null;
  /** 지금 그린 선(force-graph가 끝을 점 객체로 바꾼 사본)과 마우스를 올린 선 */
  links: GraphLink[];
  hoverLink: GraphLink | null;
}

// 강조 테두리가 점 밖으로 나오는 만큼
export const FOCUS_RING = 3;

export const radiusOf = (node: GraphNode): number => 4 + Math.sqrt(node.degree) * 2;
export const idOf = (end: unknown): string => (typeof end === 'object' && end !== null ? (end as { id: string }).id : String(end));

export function isRelated(state: ViewState, id: string): boolean {
  // 경로 위의 점은 다른 점에 마우스를 올려도 흐리게 하지 않는다(길 전체가 보이게)
  if (state.hoverId === null || state.pathNodes.has(id)) return true;
  return id === state.hoverId || state.neighbors.get(state.hoverId)?.has(id) === true;
}

export function isActive(state: ViewState, link: GraphLink): boolean {
  if (link === state.hoverLink) return true;
  const [source, target] = [idOf(link.source), idOf(link.target)];
  if (state.pathLinks.has(`${source}\u0000${target}`)) return true;
  return state.hoverId !== null && (source === state.hoverId || target === state.hoverId);
}

// 그래프 좌표 (x, y)에 가장 가까운 점. 점 가장자리에서 `margin`(최소 2)만큼 여유를 둔다
export function nodeAt(state: ViewState, x: number, y: number, margin = 2): ViewNode | undefined {
  let nearest: ViewNode | undefined;
  let nearestGap = Infinity;
  for (const node of state.nodes.values()) {
    if (node.x === undefined || node.y === undefined) continue;
    const gap = Math.hypot(node.x - x, node.y - y) - radiusOf(node);
    if (gap <= Math.max(2, margin) && gap < nearestGap) {
      nearest = node;
      nearestGap = gap;
    }
  }
  return nearest;
}
