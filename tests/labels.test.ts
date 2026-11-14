import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitLabel, LABEL_PRIORITY, labelPriority, MAX_LABEL_WIDTH, pickLabels, pullFor } from '../src/extension/graph-view/labels.ts';

const box = (id: string, x: number, priority: number, weight = 0) => ({
  id, text: id, x, y: 0, width: 10, height: 4, priority, weight, always: priority <= LABEL_PRIORITY.hover,
});

test('이름표: 우선순위 높은 것부터 놓고 겹치면 건너뛰며, 고른·올린 점은 늘 보여 준다', () => {
  const picked = pickLabels(
    [box('far', 100, LABEL_PRIORITY.other), box('small', 5, LABEL_PRIORITY.other, 1), box('hub', 3, LABEL_PRIORITY.hub), box('big', 6, LABEL_PRIORITY.other, 9), box('focus', 8, LABEL_PRIORITY.focus)],
    10,
  ).map((b) => b.id);
  // focus(8~18)가 먼저 놓이고, 겹치는 hub(3~13)·big(6~16)·small(5~15)은 건너뛰며, 떨어진 far는 남는다
  assert.deepEqual(picked, ['focus', 'far']);
  const hover = pickLabels([box('focus', 0, LABEL_PRIORITY.focus), box('hover', 2, LABEL_PRIORITY.hover)], 10).map((b) => b.id);
  assert.deepEqual(hover, ['focus', 'hover'], '고른 점과 올린 점은 겹쳐도 둘 다');
  assert.equal(pickLabels([box('a', 0, 4), box('b', 20, 4), box('c', 40, 4)], 2).length, 2, '최대 개수');
  assert.deepEqual(pickLabels([box('light', 0, 4, 1), box('heavy', 5, 4, 5)], 10).map((b) => b.id), ['heavy'], '같은 우선순위는 큰 점이 먼저');
});

test('이름표 우선순위: 고른 점 → 올린 점 → 이웃 → 허브, 다른 점에 올려 고른 점이 흐려지면 허브처럼', () => {
  const neighbors = new Map([['f', new Set(['n'])], ['h', new Set(['m'])], ['n', new Set(['f'])], ['m', new Set(['h'])]]);
  const base = { focusId: 'f', hoverId: null, neighbors, hubIds: new Set(['hub']) };
  assert.deepEqual(['f', 'n', 'hub', 'x'].map((id) => labelPriority(base, id)), [LABEL_PRIORITY.focus, LABEL_PRIORITY.related, LABEL_PRIORITY.hub, LABEL_PRIORITY.other]);
  const hovering = { ...base, hoverId: 'h' };
  assert.deepEqual(['h', 'm', 'n', 'f'].map((id) => labelPriority(hovering, id)), [LABEL_PRIORITY.hover, LABEL_PRIORITY.related, LABEL_PRIORITY.other, LABEL_PRIORITY.hub]);
  assert.equal(labelPriority({ ...base, hoverId: 'n' }, 'f'), LABEL_PRIORITY.focus, '올린 점의 이웃이면 그대로 고른 점');
});

test('이름표 말줄임: 상한을 넘는 제목만 "…"로 자르고 상한 안에 든다', () => {
  const measure = (text: string) => [...text].length * 10;
  assert.deepEqual(fitLabel('짧은 제목', measure), { text: '짧은 제목', width: 50 });
  const long = fitLabel('가'.repeat(40), measure);
  assert.ok(long.text.endsWith('…') && long.width <= MAX_LABEL_WIDTH, long.text);
  assert.equal(long.width, MAX_LABEL_WIDTH, '들어가는 만큼은 남긴다');
});

test('당기는 힘: 화면 모양을 따르되 비율은 0.5~2로 묶고, 크기가 0이면 그대로 둔다', () => {
  assert.deepEqual(pullFor(1000, 500, 0.04), { x: 0.02, y: 0.04 });
  assert.deepEqual(pullFor(500, 1000, 0.04), { x: 0.04, y: 0.02 });
  assert.deepEqual(pullFor(400, 80, 0.04), { x: 0.02, y: 0.04 }, '아주 납작해도 한쪽이 0에 가깝지 않게');
  assert.equal(pullFor(0, 0, 0.04), null);
});
