import type { UnreadableReason } from '../graph/types.ts';
import type { NotionRequest, NotionResponse } from './http.ts';
import { asRecord, codeOf, nextCursorOf } from './json.ts';
import type { Json } from './json.ts';
import { normalizeId } from './urlToPageId.ts';

export type Requester = (req: NotionRequest) => Promise<NotionResponse>;
export type NotionObject = Json;

// 하위 페이지·데이터베이스는 계층일 뿐이라 본문을 따라 들어가지 않는다
const NO_FOLLOW = new Set(['child_page', 'child_database']);

export class NotionApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string) {
    super(`Notion 요청 실패: ${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

function ensureOk(res: NotionResponse): Json {
  if (res.status !== 200) throw new NotionApiError(res.status, codeOf(res.body));
  return asRecord(res.body);
}

const listOf = (body: Json): unknown[] => (Array.isArray(body.results) ? body.results : []);

export type TokenCheck = { ok: true } | { ok: false; status: number; code: string };

/** 토큰 검사(F-1). 가장 가벼운 요청 하나로 401 여부를 본다. */
export async function checkToken(request: Requester): Promise<TokenCheck> {
  const res = await request({ method: 'GET', path: '/v1/users/me' });
  return res.status === 200 ? { ok: true } : { ok: false, status: res.status, code: codeOf(res.body) };
}

/** 검색 한 쪽(최대 100개). 검색은 완전한 목록을 보장하지 않고 수십 초 늦게 반영될 수 있다. */
export async function searchPagesOnce(
  request: Requester,
  cursor?: string,
): Promise<{ results: NotionObject[]; nextCursor?: string }> {
  const body = ensureOk(
    await request({
      method: 'POST',
      path: '/v1/search',
      body: {
        filter: { property: 'object', value: 'page' },
        sort: { timestamp: 'last_edited_time', direction: 'descending' },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      },
    }),
  );
  const nextCursor = nextCursorOf(body);
  return { results: listOf(body).map(asRecord), ...(nextCursor ? { nextCursor } : {}) };
}

/** 접근 가능한 모든 페이지를 검색으로 끝까지 받는다(시험용). */
export async function searchAllPages(request: Requester): Promise<{ pages: NotionObject[]; requests: number }> {
  const pages: NotionObject[] = [];
  let cursor: string | undefined;
  let requests = 0;
  do {
    const page = await searchPagesOnce(request, cursor);
    requests += 1;
    pages.push(...page.results);
    cursor = page.nextCursor;
  } while (cursor);
  return { pages, requests };
}

/** 페이지 본문의 블록을 1단계씩 내려가며 모두 읽는다. 읽는 동안 메모리에서만 쓴다. */
export async function readBlockTree(
  request: Requester,
  rootId: string,
): Promise<{ blocks: NotionObject[]; requests: number }> {
  const blocks: NotionObject[] = [];
  const pending = [rootId];
  let requests = 0;
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    let cursor: string | undefined;
    do {
      const suffix = cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : '';
      const body = ensureOk(await request({ method: 'GET', path: `/v1/blocks/${id}/children?page_size=100${suffix}` }));
      requests += 1;
      for (const block of listOf(body).map(asRecord)) {
        blocks.push(block);
        const follow = block.has_children === true && !NO_FOLLOW.has(String(block.type));
        if (follow && typeof block.id === 'string') pending.push(block.id);
      }
      cursor = nextCursorOf(body);
    } while (cursor);
  }
  return { blocks, requests };
}

export type PageFetch =
  | { kind: 'ok'; page: NotionObject }
  | { kind: 'unreadable'; reason: UnreadableReason }
  | { kind: 'failed'; status: number };

/** 페이지 하나를 읽고 결과를 분류한다. 401(토큰 문제)은 오류로 올리고, 400은 데이터베이스 같은 페이지가 아닌 대상이다(시험 S-7). */
export async function fetchPage(request: Requester, id: string): Promise<PageFetch> {
  const res = await request({ method: 'GET', path: `/v1/pages/${id}` });
  if (res.status === 200) return { kind: 'ok', page: asRecord(res.body) };
  if (res.status === 401) throw new NotionApiError(401, codeOf(res.body));
  if (res.status === 403) return { kind: 'unreadable', reason: 'forbidden' };
  if (res.status === 404) return { kind: 'unreadable', reason: 'not-found' };
  if (res.status === 400) return { kind: 'unreadable', reason: 'not-a-page' };
  return { kind: 'failed', status: res.status };
}

/** relation이 25개를 넘으면 페이지 응답에 일부만 오므로 속성 항목 API로 나머지를 읽는다. */
export async function readRelationOverflow(request: Requester, pageId: string, page: NotionObject): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of Object.values(asRecord(page.properties))) {
    const property = asRecord(raw);
    if (property.type !== 'relation' || property.has_more !== true || typeof property.id !== 'string') continue;
    const base = `/v1/pages/${pageId}/properties/${encodeURIComponent(property.id)}?page_size=100`;
    let cursor: string | undefined;
    do {
      const suffix = cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : '';
      const body = ensureOk(await request({ method: 'GET', path: `${base}${suffix}` }));
      for (const item of listOf(body)) {
        const target = asRecord(asRecord(item).relation).id;
        const id = typeof target === 'string' ? normalizeId(target) : null;
        if (id) ids.push(id);
      }
      cursor = nextCursorOf(body);
    } while (cursor);
  }
  return ids;
}
