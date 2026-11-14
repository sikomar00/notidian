import { buildGraph } from './buildGraph.ts';
import { applyFilters, hideIsolated } from './filter.ts';
import type { KindFilter } from './filter.ts';
import { buildRows } from './rows.ts';
import type { NodeRow } from './rows.ts';
import type { GraphData, PageRecord, RawLink } from './types.ts';

export interface ViewOptions {
  /** 하위 페이지 선을 그린다 */
  hierarchy: boolean;
  /** 범례로 숨긴 종류 */
  hidden: KindFilter;
  /** 연결 없는 페이지를 숨긴다 */
  hideIsolated: boolean;
  /** 연결이 없어도 남길 페이지(지금 페이지·선택한 페이지. 숨기면 찾을 수도, 따라갈 수도 없다) */
  keep: readonly (string | null)[];
}

export interface VisibleGraph {
  /** 범례·보기 옵션을 반영한 그래프(검색·목록·받은·보낸 연결의 기준) */
  graph: GraphData;
  /** 범례만 반영한 읽을 수 있는 페이지(언급 정리 대상. 외톨이 숨기기는 빼지 않는다) */
  kindVisible: Set<string>;
  /** 목록 보기 줄(연결 많은 순) */
  rows: NodeRow[];
}

/** 저장된 페이지·연결에서 화면에 쓸 그래프를 만든다. 저장소를 다시 읽지 않고 범례·보기 옵션이 바뀔 때마다 부른다. */
export function visibleGraph(pages: readonly PageRecord[], links: readonly RawLink[], options: ViewOptions): VisibleGraph {
  const filtered = applyFilters(buildGraph(pages, links, { hierarchy: options.hierarchy }), options.hidden);
  const kindVisible = new Set(filtered.nodes.flatMap((node) => (node.unreadable ? [] : [node.id])));
  const graph = options.hideIsolated ? hideIsolated(filtered, options.keep) : filtered;
  return { graph, kindVisible, rows: buildRows(graph) };
}
