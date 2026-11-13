export type PageKind = 'page' | 'dbItem';
export type PageStatus = 'pending' | 'ok' | 'unreadable';
// not-a-page: 데이터베이스처럼 페이지가 아닌 대상. 그래프에 그리지 않는다
export type UnreadableReason = 'forbidden' | 'not-found' | 'not-a-page' | 'error';

export interface PageRecord {
  id: string;
  title: string;
  kind: PageKind;
  url: string;
  lastEdited: string;
  parentPageId?: string;
  status: PageStatus;
  unreadableReason?: UnreadableReason;
  readAt?: string;
  /** 읽지 않고 존재만 확인한 시각(검색에 안 나오는 페이지를 다시 확인할 때) */
  checkedAt?: string;
  failCount: number;
  /** 검색이나 존재 확인 때 받은 페이지 속성에서 미리 뽑은 연결. 같은 색인(`crawl` = 시작 시각) 안에서 읽을 때 페이지를 다시 받지 않으려고 둔다. `at`은 속성을 받은 시각 */
  prefetched?: PropertyLinks & { crawl: string; at: string };
}

/** 페이지 속성에서 나온 연결(relation·제목 속 언급)과, 25개를 넘어 따로 읽어야 하는 relation 속성 ID */
export interface PropertyLinks {
  targets: string[];
  overflow: string[];
}

export interface RawLink {
  from: string;
  to: string;
}

export interface MergedLink {
  source: string;
  target: string;
  bidirectional: boolean;
}

export interface GraphLink extends MergedLink {
  hierarchy: boolean;
}

export interface GraphNode {
  id: string;
  title: string;
  kind: PageKind;
  unreadable: boolean;
  degree: number;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
