import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SHOW_ALL } from '../src/graph/filter.ts';
import type { PageRecord } from '../src/graph/types.ts';
import { visibleGraph } from '../src/graph/visibleGraph.ts';

const page = (id: string, extra: Partial<PageRecord> = {}): PageRecord => ({ id, title: id, kind: 'page', url: '', lastEdited: '', status: 'ok', failCount: 0, ...extra });
const pages = [page('a'), page('b', { kind: 'dbItem', databaseId: 'db' }), page('lonely'), page('kept'), page('child', { parentPageId: 'a' })];
const links = [{ from: 'a', to: 'b' }];

test('화면 그래프: 범례·하위 페이지 선·외톨이 숨기기를 반영하고, 언급 정리 대상은 범례만 반영한다', () => {
  const all = visibleGraph(pages, links, { hierarchy: false, hidden: SHOW_ALL, hideIsolated: false, keep: [] });
  assert.equal(all.graph.nodes.length, 5);
  assert.equal(all.graph.links.length, 1);
  const withHierarchy = visibleGraph(pages, links, { hierarchy: true, hidden: SHOW_ALL, hideIsolated: false, keep: [] });
  assert.deepEqual(withHierarchy.graph.links.filter((l) => l.hierarchy).map((l) => [l.source, l.target]), [['a', 'child']], '하위 페이지 선을 켜면 상위→하위 선이 더해진다');
  assert.equal(all.rows[0]?.id, 'a', '목록은 연결 많은 순');
  const noDb = visibleGraph(pages, links, { hierarchy: true, hidden: { ...SHOW_ALL, dbItem: true }, hideIsolated: true, keep: ['kept'] });
  assert.deepEqual(noDb.graph.nodes.map((n) => n.id).sort(), ['kept'], 'DB 항목을 숨기면 a도 외톨이가 되고, 남길 페이지만 남는다');
  assert.deepEqual([...noDb.kindVisible].sort(), ['a', 'child', 'kept', 'lonely'], '언급 정리 대상은 외톨이 숨기기를 반영하지 않는다');
});
