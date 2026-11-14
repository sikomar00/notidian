import type { PageRecord, RawLink } from '../../graph/types.ts';
import type { Counts, CrawlState, IndexStore, StoredText } from './types.ts';

const DB_NAME = 'notidian';
// 2: 본문 글자 `texts`(연결 안 된 언급)
const DB_VERSION = 2;
const CRAWL_KEY = 'state';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    // 이미 만든 지도는 남기고 없는 저장소만 더한다
    opening.onupgradeneeded = (event) => {
      const db = opening.result;
      if (event.oldVersion < 1) {
        db.createObjectStore('pages', { keyPath: 'id' }).createIndex('status', 'status');
        const links = db.createObjectStore('links', { keyPath: ['from', 'to'] });
        links.createIndex('from', 'from');
        links.createIndex('to', 'to');
        db.createObjectStore('crawl');
      }
      if (event.oldVersion < 2) db.createObjectStore('texts', { keyPath: 'id' });
    };
    // 예전 버전 연결이 남아 있으면 버전 올리기가 끝없이 기다리므로 이유를 알린다
    opening.onblocked = () => reject(new Error('다른 Notidian 화면이 예전 저장소를 쓰고 있어요. 열린 Notidian 탭을 모두 닫고 다시 열어 주세요'));
    opening.onsuccess = () => {
      // 다음에 버전을 올릴 때 이 연결이 막지 않게 스스로 닫는다
      opening.result.onversionchange = () => opening.result.close();
      resolve(opening.result);
    };
    opening.onerror = () => reject(opening.error);
  });
}

// 연결 저장소에서 해당 인덱스 값에 걸린 연결을 모두 지운다(같은 트랜잭션 안에서 호출)
async function deleteLinksBy(links: IDBObjectStore, index: 'from' | 'to', id: string): Promise<void> {
  const keys = await request(links.index(index).getAllKeys(IDBKeyRange.only(id)));
  for (const key of keys) links.delete(key);
}

/** IndexedDB `notidian`에 색인을 저장한다. 본문 글자는 연결 안 된 언급용으로 `texts`에 따로 둔다(ADR 0004). */
class IdbStore implements IndexStore {
  private database: Promise<IDBDatabase> | undefined;

  private open(): Promise<IDBDatabase> {
    this.database ??= openDatabase();
    return this.database;
  }

  private async stores(names: string[], mode: IDBTransactionMode): Promise<IDBTransaction> {
    return (await this.open()).transaction(names, mode);
  }

  async getPage(id: string): Promise<PageRecord | undefined> {
    const tx = await this.stores(['pages'], 'readonly');
    return request<PageRecord | undefined>(tx.objectStore('pages').get(id));
  }

  async putPage(page: PageRecord): Promise<void> {
    const tx = await this.stores(['pages'], 'readwrite');
    tx.objectStore('pages').put(page);
    await finished(tx);
  }

  async deletePage(id: string): Promise<void> {
    const tx = await this.stores(['pages', 'links', 'texts'], 'readwrite');
    tx.objectStore('pages').delete(id);
    tx.objectStore('texts').delete(id);
    const links = tx.objectStore('links');
    await deleteLinksBy(links, 'from', id);
    await deleteLinksBy(links, 'to', id);
    await finished(tx);
  }

  async listPages(): Promise<PageRecord[]> {
    const tx = await this.stores(['pages'], 'readonly');
    return request<PageRecord[]>(tx.objectStore('pages').getAll());
  }

  async pendingIds(): Promise<string[]> {
    const tx = await this.stores(['pages'], 'readonly');
    return request<string[]>(tx.objectStore('pages').index('status').getAllKeys('pending') as IDBRequest<string[]>);
  }

  async replaceLinks(from: string, targets: readonly string[]): Promise<void> {
    const tx = await this.stores(['links'], 'readwrite');
    const links = tx.objectStore('links');
    await deleteLinksBy(links, 'from', from);
    for (const to of new Set(targets)) links.put({ from, to });
    await finished(tx);
  }

  async allLinks(): Promise<RawLink[]> {
    const tx = await this.stores(['links'], 'readonly');
    return request<RawLink[]>(tx.objectStore('links').getAll());
  }

  async putText(id: string, text: string): Promise<void> {
    const tx = await this.stores(['texts'], 'readwrite');
    if (text === '') tx.objectStore('texts').delete(id);
    else tx.objectStore('texts').put({ id, text } satisfies StoredText);
    await finished(tx);
  }

  async listTexts(): Promise<StoredText[]> {
    const tx = await this.stores(['texts'], 'readonly');
    return request<StoredText[]>(tx.objectStore('texts').getAll());
  }

  async getCrawl(): Promise<CrawlState | undefined> {
    const tx = await this.stores(['crawl'], 'readonly');
    return request<CrawlState | undefined>(tx.objectStore('crawl').get(CRAWL_KEY));
  }

  async putCrawl(state: CrawlState): Promise<void> {
    const tx = await this.stores(['crawl'], 'readwrite');
    tx.objectStore('crawl').put(state, CRAWL_KEY);
    await finished(tx);
  }

  async counts(): Promise<Counts> {
    const tx = await this.stores(['pages'], 'readonly');
    const pages = tx.objectStore('pages');
    const [total, pending] = await Promise.all([request(pages.count()), request(pages.index('status').count('pending'))]);
    return { read: total - pending, discovered: total };
  }

  async clear(): Promise<void> {
    const names = ['pages', 'links', 'crawl', 'texts'];
    const tx = await this.stores(names, 'readwrite');
    for (const name of names) tx.objectStore(name).clear();
    await finished(tx);
  }
}

export function openIdbStore(): IndexStore {
  return new IdbStore();
}
