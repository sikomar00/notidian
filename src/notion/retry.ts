import type { Requester } from './endpoints.ts';

export class RateLimitedError extends Error {}

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 429로 기다리는 동안 화면에 "잠시 대기 중"을 보여 주려고 끝나는 시각을 알려 준다. */
  onWait?: (untilMs: number) => void;
}

const MAX_RATE_LIMITED = 5;
const MAX_ATTEMPTS = 3;
const MAX_WAIT_SEC = 60;
const DEFAULT_WAIT_SEC = 5;

/**
 * 429는 Retry-After(최대 60초)만큼 기다려 다시 보내고 연속 5번이면 포기한다.
 * 5xx와 네트워크 오류는 3번까지 점점 길게 기다린다. 5xx가 끝내 안 풀리면 마지막 응답을 돌려줘 호출하는 쪽이 정한다.
 */
export function withRetry(request: Requester, deps: RetryDeps = {}): Requester {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;

  return async function retrying(req) {
    let rateLimited = 0;
    let failures = 0;
    for (;;) {
      try {
        const res = await request(req);
        if (res.status === 429) {
          rateLimited += 1;
          if (rateLimited > MAX_RATE_LIMITED) throw new RateLimitedError('호출 제한이 계속되어 멈춥니다');
          const waitMs = Math.min(res.retryAfterSec ?? DEFAULT_WAIT_SEC, MAX_WAIT_SEC) * 1000;
          deps.onWait?.(now() + waitMs);
          await sleep(waitMs);
          continue;
        }
        failures += res.status >= 500 ? 1 : 0;
        if (res.status < 500 || failures >= MAX_ATTEMPTS) return res;
      } catch (error) {
        // 네트워크 오류(TypeError)만 다시 시도한다. 허용되지 않은 요청 같은 코드 오류는 그대로 올린다
        failures += 1;
        if (!(error instanceof TypeError) || failures >= MAX_ATTEMPTS) throw error;
      }
      await sleep(1000 * 2 ** (failures - 1));
    }
  };
}
