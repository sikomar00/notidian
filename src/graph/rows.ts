import type { GraphData, PageKind } from './types.ts';

/** 목록 보기와 선택 막대에 쓰는 한 줄. 받은 연결 = 이 페이지를 가리키는 페이지 수, 보낸 연결 = 이 페이지가 가리키는 페이지 수. */
export interface NodeRow {
  id: string;
  title: string;
  kind: PageKind;
  unreadable: boolean;
  received: number;
  sent: number;
}

function bump(map: Map<string, number>, id: string): void {
  map.set(id, (map.get(id) ?? 0) + 1);
}

/** 점마다 받은·보낸 연결 수를 센다(하위 페이지 선은 연결이 아니라 뺀다). 양쪽으로 이어진 선은 양쪽에 센다. 연결이 많은 순. */
export function buildRows(data: GraphData): NodeRow[] {
  const received = new Map<string, number>();
  const sent = new Map<string, number>();
  for (const link of data.links) {
    if (link.hierarchy) continue;
    bump(sent, link.source);
    bump(received, link.target);
    if (link.bidirectional) {
      bump(sent, link.target);
      bump(received, link.source);
    }
  }
  return data.nodes
    .map((node) => ({
      id: node.id,
      title: node.title,
      kind: node.kind,
      unreadable: node.unreadable,
      received: received.get(node.id) ?? 0,
      sent: sent.get(node.id) ?? 0,
    }))
    .sort((a, b) => b.received + b.sent - (a.received + a.sent) || a.title.localeCompare(b.title, 'ko'));
}
