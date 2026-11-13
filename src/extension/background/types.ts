import type { PageRecord, RawLink } from '../../graph/types.ts';

export type CrawlPhase = 'search' | 'read' | 'cleanup' | 'done';

/** 색인 진행 위치. 서비스 워커가 꺼져도 여기서 이어 읽는다. */
export interface CrawlState {
  phase: CrawlPhase;
  searchCursor?: string;
  seenIds: string[];
  startedAt: string;
}

export interface Counts {
  read: number;
  discovered: number;
}

/** 색인 저장소. 실행 환경은 IndexedDB(idbStore.ts), 테스트는 메모리 구현을 쓴다. */
export interface IndexStore {
  getPage(id: string): Promise<PageRecord | undefined>;
  putPage(page: PageRecord): Promise<void>;
  /** 페이지와 그 페이지에서 나가는·들어오는 연결을 모두 지운다. */
  deletePage(id: string): Promise<void>;
  listPages(): Promise<PageRecord[]>;
  pendingIds(): Promise<string[]>;
  /** `from` 페이지의 나가는 연결을 통째로 바꾼다. */
  replaceLinks(from: string, targets: readonly string[]): Promise<void>;
  allLinks(): Promise<RawLink[]>;
  getCrawl(): Promise<CrawlState | undefined>;
  putCrawl(state: CrawlState): Promise<void>;
  counts(): Promise<Counts>;
  clear(): Promise<void>;
}

export type ProgressPhase = 'idle' | 'running' | 'paused' | 'done' | 'error';

/** 화면이 보는 진행 상태. `chrome.storage.local`의 `progress`에 둔다. */
export interface Progress {
  phase: ProgressPhase;
  read: number;
  discovered: number;
  waitingUntil?: number;
  lastError?: string;
  /** 지도를 마지막으로 다 만든 시각(ms). "N분 전 갱신"에 쓴다. 다시 만드는 동안에도 남겨 둔다 */
  finishedAt?: number;
  /** 자동 다시 만들기가 시작한 실행인지. 이때는 화면 읽기 프로그램에 알리지 않고, 멈추면 다음 주기에 이어서 한다 */
  auto?: boolean;
}

export const IDLE_PROGRESS: Progress = { phase: 'idle', read: 0, discovered: 0 };
