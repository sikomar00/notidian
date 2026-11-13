import { mergeLinks } from './mergeLinks.ts';
import type { GraphData, GraphLink, GraphNode, PageRecord, RawLink } from './types.ts';

export const UNREADABLE_TITLE = '읽을 수 없는 페이지';

function placeholder(id: string): GraphNode {
  return { id, title: UNREADABLE_TITLE, kind: 'page', unreadable: true, degree: 0 };
}

/**
 * 색인(페이지·연결)에서 그릴 점과 선을 만든다.
 * 색인에 없는 연결 대상은 회색 "읽을 수 없는 페이지" 점이 되고(F-5), 데이터베이스 같은 페이지가 아닌 대상(not-a-page)은 점도 선도 만들지 않는다.
 */
export function buildGraph(
  pages: readonly PageRecord[],
  rawLinks: readonly RawLink[],
  options: { hierarchy: boolean },
): GraphData {
  const hidden = new Set(pages.filter((page) => page.unreadableReason === 'not-a-page').map((page) => page.id));
  const nodes = new Map<string, GraphNode>();
  for (const page of pages) {
    if (hidden.has(page.id)) continue;
    nodes.set(page.id, { id: page.id, title: page.title, kind: page.kind, unreadable: page.status === 'unreadable', degree: 0 });
  }
  const merged = mergeLinks(rawLinks.filter((link) => !hidden.has(link.from) && !hidden.has(link.to)));
  for (const { source, target } of merged) {
    for (const id of [source, target]) {
      if (!nodes.has(id)) nodes.set(id, placeholder(id));
      const node = nodes.get(id);
      if (node) node.degree += 1;
    }
  }
  const links: GraphLink[] = merged.map((link) => ({ ...link, hierarchy: false }));
  if (options.hierarchy) {
    for (const page of pages) {
      if (page.parentPageId && nodes.has(page.parentPageId) && nodes.has(page.id)) {
        links.push({ source: page.parentPageId, target: page.id, bidirectional: false, hierarchy: true });
      }
    }
  }
  return { nodes: [...nodes.values()], links };
}
