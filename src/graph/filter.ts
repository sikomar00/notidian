import { neighborMap } from './neighbors.ts';
import type { GraphData, GraphNode } from './types.ts';

/** `true`인 종류는 숨긴다. 범례를 눌러 점 종류를 보이거나 숨길 때 쓴다. */
export interface KindFilter {
  page: boolean;
  dbItem: boolean;
  unreadable: boolean;
}

export const SHOW_ALL: KindFilter = { page: false, dbItem: false, unreadable: false };

function isHidden(node: GraphNode, hidden: KindFilter): boolean {
  if (node.unreadable) return hidden.unreadable;
  return node.kind === 'dbItem' ? hidden.dbItem : hidden.page;
}

/** 숨긴 종류의 점과 그 점에 닿는 선을 뺀다. 점의 연결 수는 남은 연결 기준으로 다시 센다. */
export function applyFilters(data: GraphData, hidden: KindFilter): GraphData {
  if (!hidden.page && !hidden.dbItem && !hidden.unreadable) return data;
  return keepOnly(data, new Set(data.nodes.filter((node) => !isHidden(node, hidden)).map((node) => node.id)));
}

/** 연결이 하나도 없는 점(외톨이)을 뺀다. 하위 페이지 선은 연결로 치지 않는다. `keep`의 점은 외톨이여도 남긴다. */
export function hideIsolated(data: GraphData, keep: readonly (string | null)[] = []): GraphData {
  return keepOnly(data, new Set(data.nodes.filter((node) => node.degree > 0 || keep.includes(node.id)).map((node) => node.id)));
}

/** 선택한 페이지에서 `depth`단계 안에 있는 점만 남긴다(방향은 따지지 않고, 그려진 선이면 하위 페이지 선도 따라간다). 그 페이지가 없으면 그대로 둔다. */
export function localSubgraph(data: GraphData, centerId: string, depth: number): GraphData {
  if (!data.nodes.some((node) => node.id === centerId)) return data;
  const around = neighborMap(data.links);
  const kept = new Set([centerId]);
  let ring = new Set([centerId]);
  for (let step = 0; step < depth && ring.size > 0; step += 1) {
    const next = new Set<string>();
    for (const id of ring) for (const other of around.get(id) ?? []) if (!kept.has(other)) next.add(other);
    for (const id of next) kept.add(id);
    ring = next;
  }
  return keepOnly(data, kept);
}

// 남길 점과 그 사이의 선만 두고, 점의 연결 수는 남은 연결(하위 페이지 선 제외) 기준으로 다시 센다
function keepOnly(data: GraphData, kept: Set<string>): GraphData {
  const links = data.links.filter((link) => kept.has(link.source) && kept.has(link.target));
  const degree = new Map<string, number>();
  for (const link of links) {
    if (link.hierarchy) continue;
    degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
    degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
  }
  const nodes = data.nodes.filter((node) => kept.has(node.id)).map((node) => ({ ...node, degree: degree.get(node.id) ?? 0 }));
  return { nodes, links };
}
