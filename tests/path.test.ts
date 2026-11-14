import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shortestPath } from '../src/graph/path.ts';
import type { GraphData } from '../src/graph/types.ts';

const node = (id: string) => ({ id, title: id, kind: 'page' as const, unreadable: false, degree: 0 });
const link = (source: string, target: string, hierarchy = false) => ({ source, target, bidirectional: false, hierarchy });

test('경로: 가장 짧은 길, 방향 무시, 하위 페이지 선 제외, 단계 상한(F-31)', () => {
  const data: GraphData = {
    nodes: ['a', 'b', 'c', 'd', 'e', 'x'].map(node),
    links: [link('a', 'b'), link('c', 'b'), link('c', 'd'), link('a', 'd'), link('d', 'e'), link('e', 'x', true)],
  };
  assert.deepEqual(shortestPath(data, { from: 'a', to: 'c' }), ['a', 'b', 'c'], '방향을 거슬러도 간다(a→b←c)');
  assert.deepEqual(shortestPath(data, { from: 'a', to: 'e' }), ['a', 'd', 'e'], '더 짧은 길');
  assert.equal(shortestPath(data, { from: 'a', to: 'x' }), null, '하위 페이지 선으로만 이어지면 길이 아니다');
  assert.deepEqual(shortestPath(data, { from: 'a', to: 'a' }), ['a']);
  assert.equal(shortestPath(data, { from: 'a', to: 'e', maxSteps: 1 }), null, '단계 상한');
  const chain: GraphData = { nodes: [], links: Array.from({ length: 7 }, (_, i) => link(`n${i}`, `n${i + 1}`)) };
  assert.equal(shortestPath(chain, { from: 'n0', to: 'n7' }), null, '7단계는 기본 상한(6) 밖');
  assert.equal(shortestPath(chain, { from: 'n0', to: 'n6' })?.length, 7);
});
