import type { LinkEvidence, PageRecord, RawLink } from '../../src/graph/types.ts';
import type { Counts, CrawlState, IndexStore, StoredText } from '../../src/extension/background/types.ts';

/** 테스트용 메모리 저장소. IndexedDB처럼 값을 복사해서 주고받는다. */
export class MemoryStore implements IndexStore {
  pages = new Map<string, PageRecord>();
  links = new Map<string, string[]>();
  crawl: CrawlState | undefined;
  texts = new Map<string, string>();
  /** `from\u0000to` → 연결 근거 */
  evidence = new Map<string, LinkEvidence>();

  async getPage(id: string): Promise<PageRecord | undefined> {
    const page = this.pages.get(id);
    return page ? structuredClone(page) : undefined;
  }

  async putPage(page: PageRecord): Promise<void> {
    this.pages.set(page.id, structuredClone(page));
  }

  async deletePage(id: string): Promise<void> {
    this.pages.delete(id);
    this.texts.delete(id);
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

  async replaceLinks(from: string, targets: readonly string[], evidence?: ReadonlyMap<string, LinkEvidence>): Promise<void> {
    for (const key of [...this.evidence.keys()]) if (key.startsWith(`${from}\u0000`)) this.evidence.delete(key);
    if (targets.length === 0) this.links.delete(from);
    else this.links.set(from, [...new Set(targets)].sort());
    for (const to of targets) {
      const found = evidence?.get(to);
      if (found) this.evidence.set(`${from}\u0000${to}`, structuredClone(found));
    }
  }

  async allLinks(): Promise<RawLink[]> {
    return [...this.links].flatMap(([from, targets]) =>
      targets.map((to) => {
        const found = this.evidence.get(`${from}\u0000${to}`);
        return { from, to, ...(found ? { evidence: structuredClone(found) } : {}) };
      }),
    );
  }

  async putText(id: string, text: string): Promise<void> {
    if (text === '') this.texts.delete(id);
    else this.texts.set(id, text);
  }

  async listTexts(): Promise<StoredText[]> {
    return [...this.texts].map(([id, text]) => ({ id, text }));
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
    this.texts.clear();
    this.crawl = undefined;
  }

  /** 두 실행 결과를 비교하려고 시각처럼 실행마다 달라지는 값을 뺀 사본을 만든다. */
  snapshot(): unknown {
    const pages = [...this.pages.values()]
      .map(({ readAt: _readAt, checkedAt: _checkedAt, ...rest }) => rest)
      .sort((a, b) => a.id.localeCompare(b.id));
    const texts = [...this.texts].sort(([a], [b]) => a.localeCompare(b));
    return { pages, links: [...this.links].sort(([a], [b]) => a.localeCompare(b)), texts };
  }
}
