import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Requester } from '../src/notion/endpoints.ts';
import type { NotionRequest, NotionResponse } from '../src/notion/http.ts';
import { RateLimitedError, withRetry } from '../src/notion/retry.ts';

const GET: NotionRequest = { method: 'GET', path: '/v1/users/me' };

function scripted(...steps: (NotionResponse | Error)[]): { request: Requester; calls: () => number } {
  let index = 0;
  const request: Requester = async () => {
    const step = steps[Math.min(index, steps.length - 1)];
    index += 1;
    if (step instanceof Error) throw step;
    return step ?? { status: 200, body: null };
  };
  return { request, calls: () => index };
}

function recorder() {
  const waits: number[] = [];
  const untils: number[] = [];
  return {
    waits,
    untils,
    deps: {
      sleep: async (ms: number) => {
        waits.push(ms);
      },
      now: () => 1000,
      onWait: (until: number) => untils.push(until),
    },
  };
}

test('429는 Retry-After초(최대 60초) 기다렸다 다시 보내고, 기다리는 동안 알려 준다', async () => {
  const rec = recorder();
  const { request } = scripted({ status: 429, body: null, retryAfterSec: 7 }, { status: 429, body: null, retryAfterSec: 999 }, { status: 200, body: 'ok' });
  const res = await withRetry(request, rec.deps)(GET);
  assert.equal(res.status, 200);
  assert.deepEqual(rec.waits, [7000, 60000]);
  assert.deepEqual(rec.untils, [8000, 61000]);
});

test('429가 연속 5번을 넘으면 포기한다', async () => {
  const rec = recorder();
  const { request, calls } = scripted({ status: 429, body: null, retryAfterSec: 1 });
  await assert.rejects(withRetry(request, rec.deps)(GET), RateLimitedError);
  assert.equal(calls(), 6);
});

test('5xx는 3번까지 점점 길게 기다리고, 끝내 안 풀리면 마지막 응답을 돌려준다', async () => {
  const rec = recorder();
  const { request, calls } = scripted({ status: 503, body: null });
  const res = await withRetry(request, rec.deps)(GET);
  assert.equal(res.status, 503);
  assert.equal(calls(), 3);
  assert.deepEqual(rec.waits, [1000, 2000]);
});

test('5xx 뒤에 성공하면 그 응답을 돌려준다', async () => {
  const rec = recorder();
  const { request } = scripted({ status: 500, body: null }, { status: 200, body: 'ok' });
  assert.equal((await withRetry(request, rec.deps)(GET)).status, 200);
});

test('네트워크 오류(TypeError)는 다시 시도하고, 그 밖의 오류는 바로 올린다', async () => {
  const rec = recorder();
  const flaky = scripted(new TypeError('Failed to fetch'), { status: 200, body: 'ok' });
  assert.equal((await withRetry(flaky.request, rec.deps)(GET)).status, 200);

  const broken = scripted(new Error('허용되지 않은 요청'));
  await assert.rejects(withRetry(broken.request, rec.deps)(GET), /허용되지 않은 요청/);
  assert.equal(broken.calls(), 1);
});

test('401·404 같은 4xx는 다시 시도하지 않는다', async () => {
  const rec = recorder();
  const { request, calls } = scripted({ status: 401, body: null });
  assert.equal((await withRetry(request, rec.deps)(GET)).status, 401);
  assert.equal(calls(), 1);
});
