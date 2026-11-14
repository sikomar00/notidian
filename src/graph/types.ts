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
  /** DB 항목이 속한 DB 번호(DB별 색에 쓴다) */
  databaseId?: string;
  status: PageStatus;
  unreadableReason?: UnreadableReason;
  readAt?: string;
  /** 읽지 않고 존재만 확인한 시각(검색에 안 나오는 페이지를 다시 확인할 때) */
  checkedAt?: string;
  failCount: number;
  /** 본문 글자를 이 규칙 버전(`TEXT_VERSION`)으로 모았는지. 다르거나 없으면 다음 다시 만들기에서 다시 읽는다(F-17) */
  textVersion?: number;
  /** 검색이나 존재 확인 때 받은 페이지 속성에서 미리 뽑은 연결. 같은 색인(`crawl` = 시작 시각) 안에서 읽을 때 페이지를 다시 받지 않으려고 둔다. `at`은 속성을 받은 시각 */
  prefetched?: PropertyLinks & { crawl: string; at: string };
}

/** 페이지 속성에서 나온 연결(relation·제목 속 언급)과, 25개를 넘어 따로 읽어야 하는 relation 속성 ID, 연결 근거(대상 → 근거) */
export interface PropertyLinks {
  targets: string[];
  overflow: string[];
  /** 연결 근거 기능 전에 받아 둔 기록에는 없다 */
  evidence?: [string, LinkEvidence][];
}

/** 저장된 페이지 본문 글자(연결 안 된 언급용). 블록마다 한 줄. */
export interface StoredText {
  id: string;
  text: string;
}

/** 연결 종류: @언급, 본문·속성 속 노션 링크, "페이지로 연결" 블록, relation 속성 */
export type LinkKind = 'mention' | 'link' | 'linkToPage' | 'relation';

/** 연결이 왜 생겼는지(F-28·F-29): 종류(여럿일 수 있음), 속성에서 나왔으면 속성 이름, 글자 속이면 처음 나온 곳의 앞뒤 글자 */
export interface LinkEvidence {
  kinds: LinkKind[];
  /** relation이나 속성 속 연결이면 그 속성 이름(처음 나온 것) */
  property?: string;
  before?: string;
  match?: string;
  after?: string;
  /** 앞뒤 글자가 속성에서 나왔으면 그 속성 이름. 없으면 본문에서 나왔다(속성 이름과 다른 곳의 문장이 섞여 보이지 않게) */
  quoteProperty?: string;
}

export interface RawLink {
  from: string;
  to: string;
  evidence?: LinkEvidence;
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
  /** DB 항목이 속한 DB 번호 */
  group?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}
