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
  const kept = new Set(data.nodes.filter((node) => !isHidden(node, hidden)).map((node) => node.id));
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
