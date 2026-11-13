import type { GraphData, GraphNode, PageKind } from './types.ts';

/** 목록 보기와 선택 막대에 쓰는 한 줄. 받은 연결 = 이 페이지를 가리키는 페이지 수, 보낸 연결 = 이 페이지가 가리키는 페이지 수. */
export interface NodeRow {
  id: string;
  title: string;
  kind: PageKind;
  unreadable: boolean;
  received: number;
  sent: number;
}

interface Neighbors {
  incoming: Set<string>;
  outgoing: Set<string>;
}

/** 점마다 받은·보낸 연결 상대. 하위 페이지 선은 연결이 아니라 빼고, 양쪽으로 이어진 선은 양쪽에 넣는다. 목록 행과 연결 패널이 같은 규칙을 쓴다. */
function neighborsOf(data: GraphData): Map<string, Neighbors> {
  const map = new Map<string, Neighbors>(data.nodes.map((node) => [node.id, { incoming: new Set(), outgoing: new Set() }]));
  const add = (from: string, to: string): void => {
    map.get(from)?.outgoing.add(to);
    map.get(to)?.incoming.add(from);
  };
  for (const link of data.links) {
    if (link.hierarchy) continue;
    add(link.source, link.target);
    if (link.bidirectional) add(link.target, link.source);
  }
  return map;
}

/** 점마다 받은·보낸 연결 수를 센다. 연결이 많은 순. */
export function buildRows(data: GraphData): NodeRow[] {
  const neighbors = neighborsOf(data);
  return data.nodes
    .map((node) => ({
      id: node.id,
      title: node.title,
      kind: node.kind,
      unreadable: node.unreadable,
      received: neighbors.get(node.id)?.incoming.size ?? 0,
      sent: neighbors.get(node.id)?.outgoing.size ?? 0,
    }))
    .sort((a, b) => b.received + b.sent - (a.received + a.sent) || a.title.localeCompare(b.title, 'ko'));
}

export interface LinkedPages {
  /** 이 페이지를 가리키는 페이지(백링크) */
  incoming: GraphNode[];
  /** 이 페이지가 가리키는 페이지 */
  outgoing: GraphNode[];
}

/** 한 페이지의 받은·보낸 연결 상대(제목 순). */
export function linkedPages(data: GraphData, id: string): LinkedPages {
  const byId = new Map(data.nodes.map((node) => [node.id, node]));
  const mine = neighborsOf(data).get(id);
  const nodesOf = (ids: Set<string> | undefined): GraphNode[] =>
    [...(ids ?? [])].flatMap((other) => byId.get(other) ?? []).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  return { incoming: nodesOf(mine?.incoming), outgoing: nodesOf(mine?.outgoing) };
}
