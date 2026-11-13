import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeProgress } from '../src/extension/progressText.ts';

test('상태마다 쉬운 말로 알려 준다', () => {
  assert.equal(describeProgress({ phase: 'idle', read: 0, discovered: 0 }), '아직 색인하지 않았습니다.');
  assert.equal(
    describeProgress({ phase: 'running', read: 12, discovered: 30 }),
    '색인 중 — 읽은 페이지 12개 / 발견한 페이지 30개',
  );
  assert.equal(describeProgress({ phase: 'done', read: 30, discovered: 30 }), '색인 완료 — 페이지 30개');
  assert.equal(describeProgress({ phase: 'paused', read: 5, discovered: 9 }), '중단됨 — 읽은 페이지 5개 / 발견한 페이지 9개');
});

test('호출 제한으로 기다리는 동안에만 "잠시 대기 중"을 붙인다', () => {
  const progress = { phase: 'running', read: 1, discovered: 2, waitingUntil: 5000 } as const;
  assert.match(describeProgress(progress, 1000), /잠시 대기 중/);
  assert.doesNotMatch(describeProgress(progress, 6000), /잠시 대기 중/);
});

test('오류는 이유와 함께 보여 준다', () => {
  const text = describeProgress({ phase: 'error', read: 1, discovered: 2, lastError: '토큰이 틀리거나 만료됐습니다' });
  assert.match(text, /토큰이 틀리거나 만료됐습니다/);
});
