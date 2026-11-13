import type { PageRecord, RawLink } from '../../graph/types.ts';

// 색인 중에는 읽을 때마다 다시 그리지 않고 2초에 한 번만 갱신한다(F-15)
const RELOAD_EVERY_MS = 2000;
// 비교 값에서 항목끼리 섞이지 않게 넣는 구분자(제목 등에 나올 수 없는 문자)
const SEP = '\u0000';

/** 그래프에 보이거나 쓰이는 것(제목·종류·상태·상위 페이지·소속 DB·주소·연결)을 하나의 비교 값으로. */
export function graphSignature(pages: readonly PageRecord[], links: readonly RawLink[]): string {
  return [
    ...pages.map((p) => [p.id, p.title, p.status, p.kind, p.parentPageId ?? '', p.databaseId ?? '', p.url].join(SEP)),
    ...links.map((l) => `${l.from}${SEP}${l.to}`),
  ].join('\n');
}

interface ReloaderDeps {
  read: () => Promise<[PageRecord[], RawLink[]]>;
  onData: (pages: PageRecord[], links: RawLink[]) => void;
  /** 저장된 지도를 읽지 못했을 때(빈 그래프가 엉뚱한 안내를 보이지 않게 알린다) */
  onError: (error: unknown) => void;
}

/**
 * 저장된 연결 지도를 다시 읽어 넘긴다. 겹친 읽기는 가장 최근 것만 쓰고,
 * 보이는 것이 그대로면 넘기지 않는다(자동 다시 만들기 중 배치가 다시 움직이지 않게).
 */
export function createReloader({ read, onData, onError }: ReloaderDeps): { reload(): Promise<void>; schedule(running: boolean): void } {
  let ticket = 0;
  let lastReload = 0;
  let lastSignature: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function reload(): Promise<void> {
    const mine = ++ticket;
    lastReload = Date.now();
    try {
      const [pages, links] = await read();
      if (mine !== ticket) return;
      const signature = graphSignature(pages, links);
      if (signature === lastSignature) return;
      onData(pages, links);
      // 다시 그리기에 성공했을 때만 기억한다(실패하면 다음 읽기에서 다시 그린다)
      lastSignature = signature;
    } catch (error) {
      if (mine === ticket) onError(error);
    }
  }

  return {
    reload,
    schedule(running) {
      clearTimeout(timer);
      const wait = running ? Math.max(0, RELOAD_EVERY_MS - (Date.now() - lastReload)) : 0;
      timer = setTimeout(() => void reload(), wait);
    },
  };
}
