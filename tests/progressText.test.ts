import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnnouncer, shouldAnnounce } from '../src/extension/announce.ts';
import { autoRefreshMinutes, shouldAutoRefresh } from '../src/extension/autoRefresh.ts';
import { describeProgress, timeAgo } from '../src/extension/progressText.ts';

test('상태마다 쉬운 말로 알려 준다(화면에서는 "연결 지도")', () => {
  assert.equal(describeProgress({ phase: 'idle', read: 0, discovered: 0 }), '아직 연결 지도를 만들지 않았어요.');
  assert.equal(describeProgress({ phase: 'running', read: 12, discovered: 30 }), '연결 지도를 만드는 중이에요 · 12 / 30개 페이지 읽음');
  assert.equal(describeProgress({ phase: 'done', read: 30, discovered: 30 }), '연결 지도 완성 · 페이지 30개');
  assert.equal(describeProgress({ phase: 'paused', read: 5, discovered: 9 }), '멈췄어요 · 5 / 9개 페이지 읽음');
});

test('호출 제한으로 기다리는 동안에만 기다린다고 붙인다', () => {
  const progress = { phase: 'running', read: 1, discovered: 2, waitingUntil: 5000 } as const;
  assert.match(describeProgress(progress, 1000), /기다리는 중/);
  assert.doesNotMatch(describeProgress(progress, 6000), /기다리는 중/);
});

test('오류와 멈춘 이유는 함께 보여 준다', () => {
  assert.match(describeProgress({ phase: 'error', read: 1, discovered: 2, lastError: '토큰이 없어요' }), /토큰이 없어요/);
  assert.match(describeProgress({ phase: 'paused', read: 1, discovered: 2, lastError: '잠시 막았어요' }), /잠시 막았어요/);
});

test('스크린리더에는 단계가 바뀔 때와 15초마다만 알린다', () => {
  assert.equal(shouldAnnounce(undefined, 'running', 0, 15_000), true);
  assert.equal(shouldAnnounce('running', 'running', 3_000, 15_000), false);
  assert.equal(shouldAnnounce('running', 'running', 15_000, 15_000), true);
  assert.equal(shouldAnnounce('running', 'done', 1, 15_000), true);
});

test('알림 영역은 읽을 때마다 바뀌지 않는다', () => {
  let clock = 0;
  const region = { textContent: '' } as HTMLElement;
  const announce = createAnnouncer(region, 15_000, () => clock);
  announce({ phase: 'running', read: 1, discovered: 10 });
  const first = region.textContent;
  clock = 2_000;
  announce({ phase: 'running', read: 2, discovered: 10 });
  assert.equal(region.textContent, first);
  clock = 3_000;
  announce({ phase: 'done', read: 10, discovered: 10 });
  assert.equal(region.textContent, '연결 지도 완성 · 페이지 10개');
});

test('마지막 갱신 시각을 "방금·N분·N시간·N일 전"으로 말한다(P2-4)', () => {
  const min = 60_000;
  assert.equal(timeAgo(0, 30_000), '방금');
  assert.equal(timeAgo(0, 5 * min), '5분 전');
  assert.equal(timeAgo(0, 125 * min), '2시간 전');
  assert.equal(timeAgo(0, 3 * 24 * 60 * min), '3일 전');
  assert.equal(describeProgress({ phase: 'done', read: 3, discovered: 3, finishedAt: 0 }, 5 * min), '연결 지도 완성 · 페이지 3개 · 5분 전 갱신');
});

test('자동 갱신: 완성 뒤 주기가 지났거나 자동 실행이 멈췄을 때만, 주기는 고를 수 있는 값만(P2-4)', () => {
  const hour = 60 * 60_000;
  const done = { phase: 'done', read: 1, discovered: 1, finishedAt: 0 } as const;
  assert.equal(shouldAutoRefresh(done, true, 60, hour), true);
  // 직접 다시 만든 지 얼마 안 됐으면 건너뛴다
  assert.equal(shouldAutoRefresh(done, true, 60, 10 * 60_000), false);
  // 자동 실행이 호출 제한·오류로 멈췄으면 다음 주기에 이어서, 사용자가 멈췄거나 직접 시작한 실행이면 건너뛴다
  assert.equal(shouldAutoRefresh({ phase: 'paused', read: 1, discovered: 2, auto: true }, true, 60, hour), true);
  assert.equal(shouldAutoRefresh({ phase: 'error', read: 1, discovered: 2, auto: true }, true, 60, hour), true);
  assert.equal(shouldAutoRefresh({ phase: 'paused', read: 1, discovered: 2 }, true, 60, hour), false);
  for (const phase of ['idle', 'running'] as const) assert.equal(shouldAutoRefresh({ phase, read: 0, discovered: 0, auto: true }, true, 60, hour), false);
  assert.equal(shouldAutoRefresh(done, false, 60, hour), false);
  assert.equal(shouldAutoRefresh(done, true, 0, hour), false);
  assert.equal(autoRefreshMinutes(60), 60);
  assert.equal(autoRefreshMinutes(7), 0);
  assert.equal(autoRefreshMinutes(undefined), 0);
});

test('자동 다시 만들기는 화면 읽기 프로그램에 알리지 않는다(P2-4)', () => {
  const region = { textContent: '' } as unknown as HTMLElement;
  const announce = createAnnouncer(region, 15_000, () => 0);
  announce({ phase: 'running', read: 1, discovered: 2, auto: true });
  announce({ phase: 'done', read: 2, discovered: 2, auto: true, finishedAt: 0 });
  assert.equal(region.textContent, '');
  announce({ phase: 'running', read: 0, discovered: 2 });
  assert.match(region.textContent ?? '', /만드는 중/);
});
