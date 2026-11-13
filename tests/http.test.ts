import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotionClient, isAllowed, NOTION_VERSION } from '../src/notion/http.ts';

const TOKEN = 'secret-token-123';

function fakeFetch(calls: { url: string; init: RequestInit }[], status = 200, retryAfter?: string): typeof fetch {
  return async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const headers = new Headers(retryAfter ? { 'Retry-After': retryAfter } : {});
    return new Response(JSON.stringify({ ok: true }), { status, headers });
  };
}

test('읽기(GET)와 검색만 허용한다', () => {
  assert.equal(isAllowed({ method: 'GET', path: '/v1/pages/x' }), true);
  assert.equal(isAllowed({ method: 'POST', path: '/v1/search' }), true);
  assert.equal(isAllowed({ method: 'POST', path: '/v1/pages' }), false);
  assert.equal(isAllowed({ method: 'PATCH', path: '/v1/pages/x' }), false);
  assert.equal(isAllowed({ method: 'DELETE', path: '/v1/blocks/x' }), false);
  assert.equal(isAllowed({ method: 'GET', path: 'https://evil.com/v1/x' }), false);
});

test('허용되지 않은 요청은 보내기 전에 거부하고, 오류에 토큰이 없다', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const request = createNotionClient(TOKEN, { fetchFn: fakeFetch(calls) });
  const bad = { method: 'PATCH', path: '/v1/pages/x' } as unknown as Parameters<typeof request>[0];
  await assert.rejects(request(bad), (error: Error) => {
    assert.ok(!error.message.includes(TOKEN));
    return true;
  });
  assert.equal(calls.length, 0);
});

test('토큰과 버전은 헤더에만 들어간다', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const request = createNotionClient(TOKEN, { fetchFn: fakeFetch(calls) });
  await request({ method: 'GET', path: '/v1/users/me' });
  const call = calls[0];
  assert.equal(call?.url, 'https://api.notion.com/v1/users/me');
  const headers = call?.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(headers['Notion-Version'], NOTION_VERSION);
  assert.ok(!call?.url.includes(TOKEN));
});

test('요청 사이를 350ms 이상 띄운다', async () => {
  let clock = 1000;
  const waits: number[] = [];
  const request = createNotionClient(TOKEN, {
    fetchFn: fakeFetch([]),
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += ms;
    },
  });
  await request({ method: 'GET', path: '/v1/users/me' });
  clock += 100;
  await request({ method: 'GET', path: '/v1/users/me' });
  assert.deepEqual(waits, [250]);
});

test('429의 Retry-After를 돌려준다', async () => {
  const request = createNotionClient(TOKEN, { fetchFn: fakeFetch([], 429, '7') });
  const res = await request({ method: 'GET', path: '/v1/users/me' });
  assert.equal(res.status, 429);
  assert.equal(res.retryAfterSec, 7);
});
