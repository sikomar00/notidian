const API_ORIGIN = 'https://api.notion.com';
export const NOTION_VERSION = '2026-03-11';
const MIN_GAP_MS = 350;

export type NotionRequest =
  | { method: 'GET'; path: string }
  | { method: 'POST'; path: '/v1/search'; body: unknown };

export interface NotionResponse {
  status: number;
  body: unknown;
  retryAfterSec?: number;
}

export interface ClientDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** 읽기(GET)와 검색(POST /v1/search)만 허용한다(NF-5). */
export function isAllowed(req: { method: string; path: string }): boolean {
  if (!req.path.startsWith('/v1/')) return false;
  if (req.method === 'GET') return true;
  return req.method === 'POST' && req.path === '/v1/search';
}

/** 요청을 한 번에 하나, 350ms 이상 간격으로 보낸다. 토큰은 헤더에만 쓰고 오류 문구에 넣지 않는다. */
export function createNotionClient(token: string, deps: ClientDeps = {}) {
  const fetchFn = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  let lastStart = -Infinity;
  let queue: Promise<unknown> = Promise.resolve();

  async function send(req: NotionRequest): Promise<NotionResponse> {
    if (!isAllowed(req)) throw new Error(`허용되지 않은 요청: ${req.method} ${req.path}`);
    const wait = lastStart + MIN_GAP_MS - now();
    if (wait > 0) await sleep(wait);
    lastStart = now();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
    };
    const init: RequestInit = { method: req.method, headers };
    if (req.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(req.body);
    }
    const res = await fetchFn(`${API_ORIGIN}${req.path}`, init);
    const body: unknown = await res.json().catch(() => null);
    const retryAfter = Number(res.headers.get('Retry-After'));
    return { status: res.status, body, ...(retryAfter > 0 ? { retryAfterSec: retryAfter } : {}) };
  }

  return function request(req: NotionRequest): Promise<NotionResponse> {
    const run = queue.then(() => send(req));
    queue = run.catch(() => undefined);
    return run;
  };
}
