import type { PageKind } from '../graph/types.ts';
import type { NotionObject } from './endpoints.ts';
import { asRecord } from './json.ts';
import { normalizeId } from './urlToPageId.ts';

export interface PageSummary {
  id: string;
  title: string;
  kind: PageKind;
  url: string;
  lastEdited: string;
  parentPageId?: string;
  /** DB 항목이 속한 데이터 소스(DB) 번호 */
  databaseId?: string;
  inTrash: boolean;
}

function titleOf(properties: unknown): string {
  for (const raw of Object.values(asRecord(properties))) {
    const property = asRecord(raw);
    if (property.type === 'title' && Array.isArray(property.title)) {
      return property.title.map((item) => String(asRecord(item).plain_text ?? '')).join('');
    }
  }
  return '';
}

/**
 * Notion 페이지 객체에서 색인에 쓸 값만 뽑는다. ID가 없으면 null.
 * 검색 결과의 부분 객체는 `lastEdited`가 빈 문자열이라 호출하는 쪽이 다시 읽어야 한다.
 */
export function summarizePage(page: NotionObject): PageSummary | null {
  const id = typeof page.id === 'string' ? normalizeId(page.id) : null;
  if (!id) return null;
  const parent = asRecord(page.parent);
  const parentPageId = parent.type === 'page_id' && typeof parent.page_id === 'string' ? normalizeId(parent.page_id) : null;
  const databaseId = parent.type === 'data_source_id' && typeof parent.data_source_id === 'string' ? normalizeId(parent.data_source_id) ?? parent.data_source_id : null;
  return {
    id,
    title: titleOf(page.properties),
    kind: parent.type === 'data_source_id' ? 'dbItem' : 'page',
    url: typeof page.url === 'string' ? page.url : '',
    lastEdited: typeof page.last_edited_time === 'string' ? page.last_edited_time : '',
    ...(parentPageId ? { parentPageId } : {}),
    ...(databaseId ? { databaseId } : {}),
    inTrash: page.in_trash === true,
  };
}
