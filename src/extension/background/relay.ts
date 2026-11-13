import { createNotionClient } from '../../notion/http.ts';
import type { NotionRequest, NotionResponse } from '../../notion/http.ts';

export type RelayResult = { ok: true; res: NotionResponse } | { ok: false; error: string };

let current: { token: string; request: ReturnType<typeof createNotionClient> } | undefined;

/** 서비스 워커에서 Notion을 호출한다. 요청 간격 큐를 공유하려고 같은 토큰이면 클라이언트를 재사용한다. */
export async function relayNotionRequest(req: NotionRequest): Promise<RelayResult> {
  const { token } = await chrome.storage.local.get('token');
  if (typeof token !== 'string' || token === '') return { ok: false, error: '토큰이 없습니다' };
  if (current?.token !== token) current = { token, request: createNotionClient(token) };
  try {
    return { ok: true, res: await current.request(req) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '알 수 없는 오류' };
  }
}
