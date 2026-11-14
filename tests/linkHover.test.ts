import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceToSegment, nearestSegment } from '../src/extension/graph-view/hitTest.ts';
import { placeTooltip, tooltipRows } from '../src/extension/graph-view/linkTooltip.ts';
import { setupHover } from '../src/extension/graph-view/hover.ts';

test('선 찾기: 선분까지 거리, 거리 안에서 가장 가까운 선(F-33)', () => {
  const seg = { x1: 0, y1: 0, x2: 10, y2: 0 };
  assert.equal(distanceToSegment(5, 3, seg), 3, '가운데 위');
  assert.equal(distanceToSegment(-3, 4, seg), 5, '끝 밖은 끝점까지');
  assert.equal(distanceToSegment(1, 1, { x1: 2, y1: 2, x2: 2, y2: 2 }), Math.SQRT2, '길이 0인 선');
  const segments = [{ item: 'far', x1: 0, y1: 10, x2: 10, y2: 10 }, { item: 'near', x1: 0, y1: 2, x2: 10, y2: 2 }];
  assert.equal(nearestSegment(segments, { x: 5, y: 3 }, 5), 'near');
  assert.equal(nearestSegment(segments, { x: 50, y: 50 }, 5), undefined, '멀면 없음');
});

test('말풍선 줄: 한 방향·양방향·하위 페이지, 근거가 없으면 근거 없이(F-33)', () => {
  const titleOf = (id: string) => id.toUpperCase();
  const evidence = { kinds: ['mention' as const], before: '', match: 'B', after: '' };
  const evidenceOf = (from: string, to: string) => (from === 'a' && to === 'b' ? evidence : undefined);
  const source = { titleOf, evidenceOf };
  assert.deepEqual(tooltipRows({ source: 'a', target: 'b', bidirectional: false, hierarchy: false }, source), [{ from: 'A', to: 'B', relation: 'link', evidence }]);
  assert.deepEqual(tooltipRows({ source: 'a', target: 'b', bidirectional: true, hierarchy: false }, source), [
    { from: 'A', to: 'B', relation: 'link', evidence },
    { from: 'B', to: 'A', relation: 'link' },
  ]);
  assert.deepEqual(tooltipRows({ source: 'a', target: 'b', bidirectional: false, hierarchy: true }, source), [{ from: 'A', to: 'B', relation: 'child' }]);
});

test('호버: 점이 먼저, 한 프레임에 한 번, 끄는 중·밖으로 나가면 선 없음, 가만히 있어도 다시 판정(F-33·F-34)', () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const container = {
    addEventListener: (type: string, listener: (event: unknown) => void) => void listeners.set(type, listener),
    getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect,
  };
  const frames: (() => void)[] = [];
  const seen: { node: string | null; link: string | null }[] = [];
  let lastNode: string | null = null;
  let nodeAtPoint: string | null = null;
  const hover = setupHover<string>(container as unknown as HTMLElement, {
    toGraph: (x, y) => ({ x, y }),
    zoom: () => 1,
    nodeAt: () => nodeAtPoint,
    segments: () => [{ item: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }],
    onNode: (id) => void (lastNode = id),
    onLink: (link) => void seen.push({ node: lastNode, link }),
    nextFrame: (callback) => void frames.push(callback),
  });
  const move = (x: number, y: number, buttons = 0) => listeners.get('mousemove')?.({ clientX: x, clientY: y, buttons });
  move(10, 1);
  move(20, 2);
  assert.equal(frames.length, 1, '여러 번 움직여도 한 프레임에 한 번');
  frames.shift()?.();
  assert.deepEqual(seen.at(-1), { node: null, link: 'line' }, '마지막 위치로 선을 찾는다');
  nodeAtPoint = 'n';
  hover.recheck();
  assert.deepEqual(seen.at(-1), { node: 'n', link: null }, '점과 겹치면 점이 먼저, 가만히 있어도 다시 판정');
  nodeAtPoint = null;
  move(30, 1, 1);
  frames.shift()?.();
  assert.equal(seen.at(-1)?.link, null, '끌어서 옮기는 중에는 선을 찾지 않는다');
  move(30, 50);
  frames.shift()?.();
  assert.equal(seen.at(-1)?.link, null, '멀면 없음');
  listeners.get('mouseleave')?.({});
  assert.deepEqual(seen.at(-1), { node: null, link: null }, '밖으로 나가면 둘 다 없음');
});

test('말풍선 자리: 오른쪽·아래가 먼저, 넘치면 반대쪽, 좁으면 위아래로 옮겨 영역 안에(F-34)', () => {
  const area = { width: 400, height: 300 };
  const box = { width: 100, height: 40 };
  assert.deepEqual(placeTooltip({ x: 50, y: 50 }, box, area), { left: 64, top: 64 });
  assert.deepEqual(placeTooltip({ x: 350, y: 280 }, box, area), { left: 236, top: 226 }, '오른쪽·아래가 넘치면 왼쪽·위');
  const narrow = placeTooltip({ x: 160, y: 100 }, { width: 286, height: 40 }, { width: 320, height: 300 });
  assert.deepEqual(narrow, { left: 17, top: 114 }, '좌우 모두 안 들어가면 커서 아래로 옮겨 가로 가운데');
  assert.ok(narrow.top > 100, '커서를 가리지 않는다');
});
