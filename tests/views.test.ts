import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSteps } from '../src/extension/options/steps.ts';
import { unknownDatabases } from '../src/extension/background/databaseNames.ts';
import { buildGraph } from '../src/graph/buildGraph.ts';
import { linksCsv, pagesCsv, toCsv } from '../src/graph/exportCsv.ts';
import { demoData } from '../src/graph/demoData.ts';
import { applyFilters, hideIsolated, localSubgraph, SHOW_ALL } from '../src/graph/filter.ts';
import type { PageRecord } from '../src/graph/types.ts';
import { fetchDataSourceTitle } from '../src/notion/endpoints.ts';
import { summarizePage } from '../src/notion/pageMapping.ts';
import { buildRows, linkedPages } from '../src/graph/rows.ts';
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

test('연결 패널: 받은·보낸 상대(양방향은 양쪽, 하위 페이지 선은 제외)가 목록 행의 수와 같다', () => {
  const ids = (id: string) => {
    const linked = linkedPages(data, id);
    return [linked.incoming.map((n) => n.id), linked.outgoing.map((n) => n.id)];
  };
  assert.deepEqual(ids('b'), [['a'], ['a', 'c']]);
  assert.deepEqual(ids('a'), [['b'], ['b']]);
  assert.deepEqual(ids('d'), [[], []]);
  for (const row of buildRows(data)) {
    const linked = linkedPages(data, row.id);
    assert.deepEqual([linked.incoming.length, linked.outgoing.length], [row.received, row.sent]);
  }
});

test('로컬 그래프: 선택한 페이지에서 단계 수만큼 방향 없이 넓히고, 연결 수를 다시 센다', () => {
  const chain: GraphData = {
    nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => node(id)),
    links: [
      { source: 'a', target: 'b', bidirectional: false, hierarchy: false },
      { source: 'c', target: 'b', bidirectional: false, hierarchy: false },
      { source: 'c', target: 'd', bidirectional: false, hierarchy: false },
      { source: 'e', target: 'd', bidirectional: false, hierarchy: true },
    ],
  };
  const ids = (depth: number) => localSubgraph(chain, 'b', depth).nodes.map((n) => n.id);
  assert.deepEqual(ids(1), ['a', 'b', 'c']);
  assert.deepEqual(ids(2), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(3), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(localSubgraph(chain, 'b', 1).nodes.find((n) => n.id === 'c')?.degree, 1);
  assert.equal(localSubgraph(chain, 'zz', 1), chain);
});

test('외톨이 숨기기: 연결이 없는 점만 뺀다(하위 페이지 선은 연결이 아니다)(P2-3)', () => {
  // d는 하위 페이지 선만 있어서 외톨이, a·b·c는 연결이 있다
  assert.deepEqual(hideIsolated(data).nodes.map((n) => n.id), ['a', 'b', 'c']);
  // 지금 페이지·선택한 페이지는 외톨이여도 남긴다
  assert.deepEqual(hideIsolated(data, ['d', null]).nodes.map((n) => n.id), ['a', 'b', 'c', 'd']);
  assert.equal(hideIsolated(data).links.some((l) => l.source === 'd' || l.target === 'd'), false);
});

const record = (id: string, databaseId?: string): PageRecord => ({ id, title: id, kind: databaseId ? 'dbItem' : 'page', url: '', lastEdited: '', status: 'ok', failCount: 0, ...(databaseId ? { databaseId } : {}) });

test('DB별 색 데이터: 페이지 요약·그래프 점에 소속 DB, 이름 모르는 DB만 고른다(P2-3)', () => {
  const summary = summarizePage({ id: uid(1), parent: { type: 'data_source_id', data_source_id: uid(9) }, properties: {} });
  assert.equal(summary?.databaseId, uid(9));
  assert.equal(summary?.kind, 'dbItem');
  assert.equal(summarizePage({ id: uid(2), parent: WORKSPACE, properties: {} })?.databaseId, undefined);
  const graph = buildGraph([record('x', 'db1'), record('y')], [], { hierarchy: false });
  assert.deepEqual(graph.nodes.map((n) => n.group), ['db1', undefined]);
  const pages = [record('x', 'db1'), record('y', 'db2'), record('z', 'db1'), record('w')];
  assert.deepEqual(unknownDatabases(pages, {}), ['db1', 'db2']);
  assert.deepEqual(unknownDatabases(pages, { db1: '할 일' }), ['db2']);
});

test('DB 이름 읽기: 이름을 돌려주고, 읽을 수 없으면 undefined(P2-3)', async () => {
  const fake = new FakeNotion();
  fake.dataSources.set('ds1', '할 일');
  assert.equal(await fetchDataSourceTitle(fake.request, 'ds1'), '할 일');
  assert.equal(await fetchDataSourceTitle(fake.request, 'missing'), undefined);
  assert.deepEqual(fake.calls, ['GET /v1/data_sources/ds1', 'GET /v1/data_sources/missing']);
  // 일시 오류는 "이름 없음"으로 굳히지 않도록 오류로 올린다
  fake.inject('/v1/data_sources/ds1', { status: 502, body: { code: 'bad_gateway' } });
  await assert.rejects(fetchDataSourceTitle(fake.request, 'ds1'), /502/);
});

test('예시 데이터: 모든 연결이 있는 페이지를 가리키고, 그래프 기능이 다 드러난다(P2-7)', () => {
  const sample = demoData();
  const ids = new Set(sample.pages.map((p) => p.id));
  for (const link of sample.links) assert.ok(ids.has(link.from) && ids.has(link.to), `${link.from}→${link.to}`);
  for (const page of sample.pages) if (page.parentPageId) assert.ok(ids.has(page.parentPageId), page.id);
  const graph = buildGraph(sample.pages, sample.links, { hierarchy: false });
  assert.ok(graph.nodes.some((n) => n.unreadable), '읽을 수 없는 페이지');
  assert.ok(graph.nodes.some((n) => n.degree === 0), '연결 없는 페이지');
  assert.equal(new Set(graph.nodes.flatMap((n) => (n.group ? [n.group] : []))).size, 3, 'DB 세 개');
  for (const group of new Set(sample.pages.flatMap((p) => (p.databaseId ? [p.databaseId] : [])))) assert.ok(group in sample.databaseNames, group);
});

test('CSV 내보내기: 엑셀용 BOM·CRLF, 쉼표·따옴표 감싸기, 수식으로 시작하는 제목은 글자로(P2-8)', () => {
  assert.equal(toCsv([['a', 1], ['b,c', 'say "hi"']]), '\uFEFFa,1\r\n"b,c","say ""hi"""\r\n');
  // 엑셀이 수식으로 실행하지 않게 앞에 '를 붙인다. 탭으로 시작하거나 전각 기호(＝＋－＠)로 시작해도 막는다
  assert.equal(toCsv([['=HYPERLINK("x")', '+1', '-2', '@a']]), '\uFEFF"\'=HYPERLINK(""x"")",\'+1,\'-2,\'@a\r\n');
  assert.equal(toCsv([['\t=1', '＝SUM(A1)', '＋1', '－1', '＠a']]), "\uFEFF'\t=1,'＝SUM(A1),'＋1,'－1,'＠a\r\n");
});

test('CSV 내보내기: 페이지 목록과 연결 목록(양방향은 두 줄, 하위 페이지는 표시)(P2-8)', () => {
  const rows = buildRows(data);
  const pages = new Map([['b', record('b', 'db1')]]);
  const csv = pagesCsv(rows, { pages, databaseNames: { db1: '할 일' }, urlOf: (id) => `https://app.notion.com/p/${id}` });
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[0], '이름,종류,받은 연결,보낸 연결,소속 DB,주소,ID');
  assert.equal(lines[1], 'b,DB 항목,1,2,할 일,https://app.notion.com/p/b,b');
  assert.ok(lines.includes('c,읽을 수 없음,1,0,,https://app.notion.com/p/c,c'), '읽을 수 없는 페이지도 주소(목록의 열기와 같게)');
  const links = linksCsv(data).slice(1).trim().split('\r\n');
  assert.deepEqual(links, [
    '출발 페이지,도착 페이지,관계,출발 ID,도착 ID',
    'a,b,가리킴,a,b',
    'b,a,가리킴,b,a',
    'b,c,가리킴,b,c',
    'd,a,상위→하위,d,a',
  ]);
});
