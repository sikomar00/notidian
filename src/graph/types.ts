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
  failCount: number;
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
