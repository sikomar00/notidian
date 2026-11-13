import type { PageRecord, RawLink } from '../../src/graph/types.ts';
import type { Counts, CrawlState, IndexStore } from '../../src/extension/background/types.ts';

/** 테스트용 메모리 저장소. IndexedDB처럼 값을 복사해서 주고받는다. */
export class MemoryStore implements IndexStore {
  pages = new Map<string, PageRecord>();
  links = new Map<string, string[]>();
  crawl: CrawlState | undefined;

  async getPage(id: string): Promise<PageRecord | undefined> {
    const page = this.pages.get(id);
    return page ? structuredClone(page) : undefined;
  }

  async putPage(page: PageRecord): Promise<void> {
    this.pages.set(page.id, structuredClone(page));
  }

  async deletePage(id: string): Promise<void> {
    this.pages.delete(id);
    this.links.delete(id);
    for (const [from, targets] of this.links) {
      const kept = targets.filter((target) => target !== id);
      if (kept.length === 0) this.links.delete(from);
      else this.links.set(from, kept);
    }
  }

  async listPages(): Promise<PageRecord[]> {
    return [...this.pages.values()].map((page) => structuredClone(page));
  }

  async pendingIds(): Promise<string[]> {
    return [...this.pages.values()].filter((page) => page.status === 'pending').map((page) => page.id);
  }

  async replaceLinks(from: string, targets: readonly string[]): Promise<void> {
    if (targets.length === 0) this.links.delete(from);
    else this.links.set(from, [...new Set(targets)].sort());
  }

  async allLinks(): Promise<RawLink[]> {
    return [...this.links].flatMap(([from, targets]) => targets.map((to) => ({ from, to })));
  }

  async getCrawl(): Promise<CrawlState | undefined> {
    return this.crawl ? structuredClone(this.crawl) : undefined;
  }

  async putCrawl(state: CrawlState): Promise<void> {
    this.crawl = structuredClone(state);
  }

  async counts(): Promise<Counts> {
    const pages = [...this.pages.values()];
    return { read: pages.filter((page) => page.status !== 'pending').length, discovered: pages.length };
  }

  async clear(): Promise<void> {
    this.pages.clear();
    this.links.clear();
    this.crawl = undefined;
  }

  /** 두 실행 결과를 비교하려고 시각처럼 실행마다 달라지는 값을 뺀 사본을 만든다. */
  snapshot(): unknown {
    const pages = [...this.pages.values()]
      .map(({ readAt: _readAt, ...rest }) => rest)
      .sort((a, b) => a.id.localeCompare(b.id));
    return { pages, links: [...this.links].sort(([a], [b]) => a.localeCompare(b)) };
  }
}
