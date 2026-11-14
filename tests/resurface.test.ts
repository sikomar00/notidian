import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickUnseen, resurfaceCandidates } from '../src/graph/resurface.ts';
import type { NodeRow } from '../src/graph/rows.ts';
import type { PageRecord } from '../src/graph/types.ts';
import { timeAgo } from '../src/extension/progressText.ts';

const row = (id: string, received: number, sent: number, unreadable = false): NodeRow => ({ id, title: id, kind: 'page', unreadable, received, sent });
const page = (id: string, lastEdited: string): PageRecord => ({ id, title: id, kind: 'page', url: '', lastEdited, status: 'ok', failCount: 0 });

test('다시 볼 페이지 후보: 무작위·잊힌(오래된 20%)·외톨이(연결 1개 이하), 읽을 수 없는 페이지는 빼고(F-38)', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id, i) => row(id, i % 3, i % 2)).concat(row('x', 0, 0, true));
  const pages = new Map(rows.map((r, i) => [r.id, page(r.id, `2026-0${(i % 9) + 1}-01T00:00:00.000Z`)]));
  assert.equal(resurfaceCandidates(rows, pages, 'random').length, 10);
  assert.deepEqual(resurfaceCandidates(rows, pages, 'forgotten'), ['a', 'j'], '가장 오래된 20%(10개 중 2개)');
  assert.deepEqual(resurfaceCandidates(rows, pages, 'lonely'), ['a', 'd', 'e', 'g', 'j'], '받은+보낸 1개 이하');
  assert.deepEqual(resurfaceCandidates([row('only', 5, 5)], new Map([['only', page('only', '2026-01-01T00:00:00.000Z')]]), 'forgotten'), ['only'], '적어도 1개');
});

test('다시 볼 페이지 고르기: 꺼낸 것은 다시 안 꺼내고, 다 돌면 처음부터(F-39)', () => {
  const seen = new Set<string>();
  const first = () => 0;
  assert.equal(pickUnseen(['a', 'b'], seen, first), 'a');
  assert.equal(pickUnseen(['a', 'b'], seen, first), 'b');
  assert.equal(pickUnseen(['a', 'b'], seen, first), 'a', '다 꺼냈으면 처음부터');
  assert.equal(pickUnseen([], seen), null);
});

test('몇 달·몇 년 전도 읽기 쉽게', () => {
  const day = 86_400_000;
  assert.equal(timeAgo(0, 3 * day), '3일 전');
  assert.equal(timeAgo(0, 65 * day), '2개월 전');
  assert.equal(timeAgo(0, 800 * day), '2년 전');
});
