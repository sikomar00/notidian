import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGraph, UNREADABLE_TITLE } from '../src/graph/buildGraph.ts';
import { contrastRatio } from '../src/graph/contrast.ts';
import { mergeLinks } from '../src/graph/mergeLinks.ts';
import { searchTitles } from '../src/graph/searchTitles.ts';
import type { PageRecord } from '../src/graph/types.ts';

const page = (id: string, title: string, extra: Partial<PageRecord> = {}): PageRecord => ({
  id,
  title,
  kind: 'page',
  url: `https://app.notion.com/${id}`,
  lastEdited: '2026-11-13T00:00:00.000Z',
  status: 'ok',
  failCount: 0,
  ...extra,
});

test('같은 쌍은 선 하나, 여러 번 가리켜도 하나', () => {
  const merged = mergeLinks([
    { from: 'a', to: 'b' },
    { from: 'a', to: 'b' },
  ]);
  assert.deepEqual(merged, [{ source: 'a', target: 'b', bidirectional: false }]);
});

test('A→B와 B→A는 양쪽 화살표 한 선', () => {
  const merged = mergeLinks([
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ]);
  assert.deepEqual(merged, [{ source: 'a', target: 'b', bidirectional: true }]);
});

test('자기 자신을 가리키는 연결은 버린다', () => {
  assert.deepEqual(mergeLinks([{ from: 'a', to: 'a' }]), []);
});

test('점 크기용 연결 수와 색인에 없는 대상의 회색 점', () => {
  const graph = buildGraph([page('a', 'A'), page('b', 'B')], [
    { from: 'a', to: 'b' },
    { from: 'a', to: 'ghost' },
  ], { hierarchy: false });
  const byId = Object.fromEntries(graph.nodes.map((node) => [node.id, node]));
  assert.equal(byId.a?.degree, 2);
  assert.equal(byId.b?.degree, 1);
  assert.equal(byId.ghost?.unreadable, true);
  assert.equal(byId.ghost?.title, UNREADABLE_TITLE);
  assert.equal(graph.links.length, 2);
});

test('읽을 수 없는 페이지(status)와 데이터베이스 항목 표시', () => {
  const graph = buildGraph([page('a', 'A', { status: 'unreadable' }), page('d', 'D', { kind: 'dbItem' })], [], { hierarchy: false });
  assert.equal(graph.nodes.find((node) => node.id === 'a')?.unreadable, true);
  assert.equal(graph.nodes.find((node) => node.id === 'd')?.kind, 'dbItem');
});

test('계층 선은 스위치를 켤 때만, 부모가 점일 때만', () => {
  const pages = [page('p', 'P'), page('c', 'C', { parentPageId: 'p' }), page('o', 'O', { parentPageId: 'missing' })];
  const off = buildGraph(pages, [], { hierarchy: false });
  const on = buildGraph(pages, [], { hierarchy: true });
  assert.equal(off.links.length, 0);
  assert.deepEqual(on.links, [{ source: 'p', target: 'c', bidirectional: false, hierarchy: true }]);
  assert.equal(on.nodes.find((node) => node.id === 'p')?.degree, 0);
});

test('제목 검색: 앞에서 시작하는 제목이 먼저, 대소문자 무시, 빈 검색은 빈 결과', () => {
  const items = [{ title: '내 Notion 노트' }, { title: 'Notion 시작' }, { title: '무관' }];
  assert.deepEqual(searchTitles(items, 'notion').map((item) => item.title), ['Notion 시작', '내 Notion 노트']);
  assert.deepEqual(searchTitles(items, '  '), []);
  assert.deepEqual(searchTitles(items, 'notion', 1).length, 1);
});

test('색 대비 계산이 WCAG 값과 맞는다', () => {
  assert.equal(contrastRatio('#000000', '#ffffff'), 21);
  assert.equal(contrastRatio('#fff', '#fff'), 1);
  assert.ok(Math.abs(contrastRatio('#767676', '#ffffff') - 4.54) < 0.01);
  assert.throws(() => contrastRatio('빨강', '#fff'));
});
