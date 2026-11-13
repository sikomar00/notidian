import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSteps } from '../src/extension/options/steps.ts';
import { applyFilters, SHOW_ALL } from '../src/graph/filter.ts';
import { buildRows } from '../src/graph/rows.ts';
import type { GraphData } from '../src/graph/types.ts';
import { probeAccess } from '../src/notion/endpoints.ts';
import { FakeNotion, uid, WORKSPACE } from './helpers/fakeNotion.ts';

const node = (id: string, kind: 'page' | 'dbItem' = 'page', unreadable = false, degree = 0) => ({ id, title: id, kind, unreadable, degree });
const data: GraphData = {
  nodes: [node('a', 'page', false, 2), node('b', 'dbItem', false, 2), node('c', 'page', true, 1), node('d')],
  links: [
    { source: 'a', target: 'b', bidirectional: true, hierarchy: false },
    { source: 'b', target: 'c', bidirectional: false, hierarchy: false },
    { source: 'd', target: 'a', bidirectional: false, hierarchy: true },
  ],
};

test('필터: 모두 보이면 그대로, 숨긴 종류의 점과 그 선을 빼고 연결 수를 다시 센다', () => {
  assert.equal(applyFilters(data, SHOW_ALL), data);
  const noDb = applyFilters(data, { page: false, dbItem: true, unreadable: false });
  assert.deepEqual(noDb.nodes.map((n) => n.id), ['a', 'c', 'd']);
  assert.equal(noDb.links.length, 1);
  assert.equal(noDb.nodes.find((n) => n.id === 'a')?.degree, 0);
  const noGray = applyFilters(data, { page: false, dbItem: false, unreadable: true });
  assert.ok(!noGray.nodes.some((n) => n.id === 'c'));
});

test('목록 행: 받은·보낸 연결 수(양방향은 양쪽, 하위 페이지 선은 제외), 많은 순', () => {
  const rows = buildRows(data);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual([byId.a?.received, byId.a?.sent], [1, 1]);
  assert.deepEqual([byId.b?.received, byId.b?.sent], [1, 2]);
  assert.deepEqual([byId.c?.received, byId.c?.sent], [1, 0]);
  assert.deepEqual([byId.d?.received, byId.d?.sent], [0, 0]);
  assert.equal(rows[0]?.id, 'b');
  assert.equal(rows.at(-1)?.id, 'd');
});

test('설정 단계: 토큰 → 연결 지도 → 그래프 순으로 진행', () => {
  const states = (hasToken: boolean, phase: Parameters<typeof computeSteps>[1]) => computeSteps(hasToken, phase).map((s) => s.state);
  assert.deepEqual(states(false, 'idle'), ['active', 'todo', 'todo']);
  assert.deepEqual(states(true, 'idle'), ['done', 'active', 'todo']);
  assert.deepEqual(states(true, 'running'), ['done', 'active', 'todo']);
  assert.deepEqual(states(true, 'paused'), ['done', 'active', 'todo']);
  assert.deepEqual(states(false, 'done'), ['active', 'todo', 'todo']);
  assert.deepEqual(states(true, 'done'), ['done', 'done', 'active']);
});

test('접근 범위 확인: 검색 한 번으로 읽을 수 있는 페이지 수를 센다', async () => {
  const fake = new FakeNotion();
  assert.deepEqual(await probeAccess(fake.request), { count: 0, more: false });
  for (let i = 1; i <= 3; i += 1) fake.add({ id: uid(i), title: `P${i}`, parent: WORKSPACE, edited: '2026-11-13T00:00:00.000Z', blocks: [] });
  assert.deepEqual(await probeAccess(fake.request), { count: 3, more: false });
  fake.searchPageSize = 2;
  assert.deepEqual(await probeAccess(fake.request), { count: 2, more: true });
});
