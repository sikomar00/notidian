import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beginCrawl, runCrawl } from '../src/extension/background/crawl.ts';
import type { CrawlDeps } from '../src/extension/background/crawl.ts';
import { buildGraph } from '../src/graph/buildGraph.ts';
import type { Requester } from '../src/notion/endpoints.ts';
import { withRetry } from '../src/notion/retry.ts';
import { childOf, DB_ITEM, FakeNotion, hex, link, mention, paragraph, uid, WORKSPACE } from './helpers/fakeNotion.ts';
import type { FakeBlock, FakePage } from './helpers/fakeNotion.ts';
import { MemoryStore } from './helpers/memoryStore.ts';

const T0 = Date.parse('2026-11-13T08:00:00.000Z');
const OLD = '2026-11-13T07:00:00.000Z';
const [ROOT, A, B, C, D, E, I1, I2, I3, T1, T2, DB] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 99].map(uid) as [
  string, string, string, string, string, string, string, string, string, string, string, string,
];
const notionUrl = (id: string): string => `https://app.notion.com/p/${hex(id)}`;

/** 시험 때 `시험용 상위 페이지` 아래에 만든 구조와 같다(docs/spike-results.md 정답표). */
function buildWorld(): FakeNotion {
  const fake = new FakeNotion();
  fake.databases.add(DB);
  const page = (id: string, title: string, parent: Record<string, unknown>, blocks: FakeBlock[] = [], extra: Partial<FakePage> = {}) =>
    fake.add({ id, title, parent, edited: OLD, blocks, ...extra });
  page(ROOT, 'ROOT', WORKSPACE);
  page(A, 'A', childOf(ROOT), [
    paragraph('a1', mention(B), link(notionUrl(C)), mention(I1)),
    { id: 'a2', type: 'heading_3', heading_3: { rich_text: [] }, children: [paragraph('a3', mention(D))] },
  ]);
  page(B, 'B', childOf(ROOT), [
    paragraph('b1', link(`https://www.notion.so/${hex(C)}`), mention(A)),
    { id: 'b2', type: 'child_page', child_page: { title: 'E' } },
  ]);
  page(C, 'C', childOf(ROOT), [paragraph('c1', link(notionUrl(DB)))]);
  page(D, 'D', childOf(ROOT), [paragraph('d1')]);
  page(E, 'E', childOf(B));
  page(T1, 'T1', DB_ITEM);
  page(T2, 'T2', DB_ITEM);
  page(I1, 'I1', DB_ITEM, [], { relation: [T1] });
  page(I2, 'I2', DB_ITEM, [], { relation: [T1, T2] });
  page(I3, 'I3', DB_ITEM);
  return fake;
}

function harness(fake: FakeNotion = buildWorld(), options: { retry?: boolean } = {}) {
  const store = new MemoryStore();
  const clock = { t: T0 };
  const stop = { value: false };
  const timed: Requester = async (req) => {
    clock.t += 350;
    return fake.request(req);
  };
  const request = options.retry ? withRetry(timed, { sleep: async () => {}, now: () => clock.t }) : timed;
  const deps: CrawlDeps = { request, store, now: () => clock.t, isStopped: () => stop.value, onProgress: () => {} };
  return { fake, store, clock, stop, deps };
}
type Harness = ReturnType<typeof harness>;

async function crawlAll(h: Harness): Promise<void> {
  await beginCrawl(h.store, h.deps.now);
  assert.deepEqual(await runCrawl(h.deps, Infinity), { kind: 'done' });
}

const targetsOf = async (h: Harness, from: string): Promise<string[]> =>
  (await h.store.allLinks()).filter((link) => link.from === from).map((link) => link.to).sort();

test('전체 색인: 시험 정답표와 같은 페이지와 연결(F-2, F-3, F-4)', async () => {
  const h = harness();
  await crawlAll(h);
  const pages = await h.store.listPages();
  assert.equal(pages.filter((page) => page.status === 'ok').length, 11);
  assert.equal((await h.store.getPage(DB))?.unreadableReason, 'not-a-page');
  assert.equal((await h.store.getPage(I1))?.kind, 'dbItem');
  assert.equal((await h.store.getPage(E))?.parentPageId, B);
  assert.deepEqual(await targetsOf(h, A), [B, C, D, I1].sort());

  const graph = buildGraph(pages, await h.store.allLinks(), { hierarchy: false });
  assert.equal(graph.nodes.length, 11);
  assert.equal(graph.links.length, 8);
  assert.equal(graph.links.find((l) => [l.source, l.target].includes(A) && [l.source, l.target].includes(B))?.bidirectional, true);
  assert.equal(buildGraph(pages, await h.store.allLinks(), { hierarchy: true }).links.length, 8 + 5);
});

test('검색이 여러 쪽이어도 결과가 같다', async () => {
  const whole = harness();
  await crawlAll(whole);
  const paged = harness();
  paged.fake.searchPageSize = 3;
  await crawlAll(paged);
  assert.deepEqual(paged.store.snapshot(), whole.store.snapshot());
  assert.equal(paged.fake.count('POST /v1/search'), 4);
});

test('중간에 끊고 이어 읽은 결과가 한 번에 읽은 결과와 같다(NF-7)', async () => {
  const once = harness();
  await crawlAll(once);
  const sliced = harness();
  await beginCrawl(sliced.store, sliced.deps.now);
  let rounds = 0;
  for (;;) {
    rounds += 1;
    assert.ok(rounds < 200, '진행이 멈췄다');
    const outcome = await runCrawl(sliced.deps, sliced.clock.t + 2 * 350);
    if (outcome.kind === 'done') break;
    assert.equal(outcome.kind, 'budget');
  }
  assert.ok(rounds > 3);
  assert.deepEqual(sliced.store.snapshot(), once.store.snapshot());
});

test('검색에 나온 페이지는 다시 받지 않고, 언급으로만 찾은 대상만 받는다(P1-5)', async () => {
  const h = harness();
  await crawlAll(h);
  // 검색에 안 나오는 대상은 C가 링크한 데이터베이스(DB)뿐이다
  assert.deepEqual(h.fake.calls.filter((call) => call.startsWith('GET /v1/pages/')), [`GET /v1/pages/${DB}`]);
  assert.deepEqual(await targetsOf(h, I2), [T1, T2].sort());
});

test('검색에 안 나오는 페이지는 언급을 따라가 페이지를 받아 읽는다', async () => {
  const fake = buildWorld();
  const hidden = fake.pages.get(D);
  assert.ok(hidden);
  hidden.searchable = false;
  hidden.relation = [E];
  const h = harness(fake);
  await crawlAll(h);
  assert.equal(h.fake.count(`GET /v1/pages/${D}`), 1);
  assert.equal((await h.store.getPage(D))?.title, 'D');
  assert.deepEqual(await targetsOf(h, D), [E]);
});

test('받아 둔 속성으로 늦게 읽어도, 수정 직후에 받은 속성이면 다음 색인에서 다시 읽는다(시험 S-4)', async () => {
  const h = harness();
  const pageD = h.fake.pages.get(D);
  assert.ok(pageD);
  pageD.edited = '2026-11-13T07:59:00.000Z';
  await beginCrawl(h.store, h.deps.now);
  // 검색만 끝내고 조각을 끊은 뒤 10분 지나서 읽는다
  assert.deepEqual(await runCrawl(h.deps, h.clock.t + 1), { kind: 'budget' });
  h.clock.t += 600_000;
  assert.deepEqual(await runCrawl(h.deps, Infinity), { kind: 'done' });
  assert.ok(Date.parse((await h.store.getPage(D))?.readAt ?? '') < T0 + 60_000);
  h.fake.calls.length = 0;
  await crawlAll(h);
  assert.equal(h.fake.count(`GET /v1/blocks/${D}/`), 1);
});

test('검색에 안 나오는 페이지가 옮겨지면 다시 확인할 때 상위 페이지도 고친다', async () => {
  const fake = buildWorld();
  const hidden = fake.pages.get(D);
  assert.ok(hidden);
  hidden.searchable = false;
  const h = harness(fake);
  await crawlAll(h);
  assert.equal((await h.store.getPage(D))?.parentPageId, ROOT);
  h.clock.t += 3_600_000;
  hidden.parent = childOf(B);
  hidden.edited = '2026-11-13T08:30:00.000Z';
  await crawlAll(h);
  assert.equal((await h.store.getPage(D))?.parentPageId, B);
  assert.equal((await h.store.getPage(D))?.prefetched, undefined);
});

test('중단하면 멈추고, 다시 돌리면 이어서 끝난다', async () => {
  const h = harness();
  await beginCrawl(h.store, h.deps.now);
  h.stop.value = true;
  assert.deepEqual(await runCrawl(h.deps, Infinity), { kind: 'stopped' });
  h.stop.value = false;
  assert.deepEqual(await runCrawl(h.deps, Infinity), { kind: 'done' });
  assert.equal((await h.store.listPages()).filter((page) => page.status === 'ok').length, 11);
});

test('바뀐 게 없으면 검색만 하고 아무 페이지도 다시 읽지 않는다(F-6)', async () => {
  const h = harness();
  await crawlAll(h);
  // 두 번, 세 번 다시 만들어도 마찬가지다(다시 읽지 않은 페이지가 글자 표시를 잃지 않는다)
  for (let run = 0; run < 2; run += 1) {
    h.clock.t += 3_600_000;
    h.fake.calls.length = 0;
    await crawlAll(h);
    assert.deepEqual(h.fake.calls, ['POST /v1/search']);
  }
});

test('고친 페이지만 다시 읽고 지운 연결은 사라진다(F-6)', async () => {
  const h = harness();
  await crawlAll(h);
  h.clock.t += 3_600_000;
  const pageA = h.fake.pages.get(A);
  assert.ok(pageA);
  pageA.blocks = [paragraph('a1', link(notionUrl(C)), mention(I1))];
  pageA.edited = '2026-11-13T08:30:00.000Z';
  h.fake.calls.length = 0;
  await crawlAll(h);
  // 검색 결과의 속성을 다시 쓰므로 페이지는 받지 않고, 고친 A의 본문만 읽는다
  assert.deepEqual(h.fake.calls.filter((call) => call.startsWith('GET')), [`GET /v1/blocks/${A}/children?page_size=100`]);
  assert.deepEqual(await targetsOf(h, A), [C, I1].sort());
});

test('수정 시각에서 2분 이내에 읽은 페이지는 다음 색인에서 한 번 더 읽는다(시험 S-4)', async () => {
  const h = harness();
  const pageD = h.fake.pages.get(D);
  assert.ok(pageD);
  pageD.edited = '2026-11-13T07:59:30.000Z';
  await crawlAll(h);
  h.clock.t += 10_000;
  h.fake.calls.length = 0;
  await crawlAll(h);
  assert.equal(h.fake.count(`GET /v1/blocks/${D}/`), 1);
  h.clock.t += 3_600_000;
  await crawlAll(h);
  h.fake.calls.length = 0;
  await crawlAll(h);
  assert.equal(h.fake.count('GET /v1/blocks/'), 0);
});

test('휴지통에 간 페이지는 지우고, 지워졌거나 접근을 잃은 페이지는 회색 점으로 남긴다(F-4, F-5)', async () => {
  const h = harness();
  await crawlAll(h);
  h.clock.t += 3_600_000;
  h.fake.pages.delete(D);
  const pageE = h.fake.pages.get(E);
  assert.ok(pageE);
  pageE.inTrash = true;
  await crawlAll(h);
  const gone = await h.store.getPage(D);
  assert.equal(gone?.status, 'unreadable');
  assert.equal(gone?.unreadableReason, 'not-found');
  assert.ok((await h.store.allLinks()).some((l) => l.from === A && l.to === D), '그 페이지를 가리키던 연결은 남는다');
  assert.equal(await h.store.getPage(E), undefined);
  const graph = buildGraph(await h.store.listPages(), await h.store.allLinks(), { hierarchy: false });
  assert.equal(graph.nodes.find((node) => node.id === D)?.unreadable, true);
});

test('검색에 안 나오는 페이지가 한 조각에 다 못 들어가도 이어서 끝난다(정리 단계 이어 돌기)', async () => {
  const h = harness();
  const extra = Array.from({ length: 40 }, (_, i) => uid(300 + i));
  for (const id of extra) h.fake.add({ id, title: `M${id}`, parent: childOf(ROOT), edited: OLD, blocks: [], searchable: false });
  const hub = h.fake.pages.get(A);
  assert.ok(hub);
  hub.blocks = [paragraph('a1', ...extra.map(mention))];
  await crawlAll(h);
  h.clock.t += 3_600_000;
  await beginCrawl(h.store, h.deps.now);
  let rounds = 0;
  for (;;) {
    rounds += 1;
    assert.ok(rounds < 60, '진행이 멈췄다');
    const outcome = await runCrawl(h.deps, h.clock.t + 20 * 350);
    if (outcome.kind === 'done') break;
    assert.equal(outcome.kind, 'budget');
  }
  assert.ok(rounds > 2);
  assert.equal((await h.store.pendingIds()).length, 0);
});

test('수정 시각에서 2분 이내에 읽은, 검색에 안 나오는 페이지도 다음 색인에서 다시 읽는다', async () => {
  const h = harness();
  const pageD = h.fake.pages.get(D);
  assert.ok(pageD);
  pageD.searchable = false;
  pageD.edited = '2026-11-13T07:59:30.000Z';
  await crawlAll(h);
  h.clock.t += 10_000;
  pageD.blocks = [paragraph('d1', mention(I3))];
  await crawlAll(h);
  assert.deepEqual(await targetsOf(h, D), [I3]);
});

test('본문(블록) 읽기가 5xx로 실패해도 그 페이지만 실패로 세고 색인은 계속한다(F-8)', async () => {
  const h = harness(buildWorld(), { retry: true });
  const bad = { status: 503, body: { code: 'service_unavailable' } };
  h.fake.inject(`/v1/blocks/${B}/children`, bad, bad, bad);
  await crawlAll(h);
  const failed = await h.store.getPage(B);
  assert.equal(failed?.status, 'pending');
  assert.equal(failed?.failCount, 1);
  for (const id of [A, C, I1]) assert.equal((await h.store.getPage(id))?.status, 'ok');
});

test('하위 블록 하나를 못 읽어도(400) 그 가지만 건너뛰고 페이지는 읽은 것으로 둔다', async () => {
  const h = harness();
  h.fake.inject('/v1/blocks/a2/children', { status: 400, body: { code: 'validation_error' } });
  await crawlAll(h);
  assert.equal((await h.store.getPage(A))?.status, 'ok');
  assert.deepEqual(await targetsOf(h, A), [B, C, I1].sort());
});

test('호출 제한(429)이 계속되면 rate-limit 오류로 멈춘다(F-8)', async () => {
  const h = harness(buildWorld(), { retry: true });
  const limited = { status: 429, body: null, retryAfterSec: 1 };
  h.fake.inject('/v1/search', ...Array.from({ length: 6 }, () => limited));
  await beginCrawl(h.store, h.deps.now);
  const outcome = await runCrawl(h.deps, Infinity);
  assert.equal(outcome.kind, 'error');
  assert.equal(outcome.kind === 'error' ? outcome.reason : '', 'rate-limit');
});

test('검색에 안 나오고 언급으로만 발견된 페이지도 읽고, 첫 색인에서 두 번 읽지 않는다', async () => {
  const h = harness();
  const pageD = h.fake.pages.get(D);
  assert.ok(pageD);
  pageD.searchable = false;
  await crawlAll(h);
  assert.equal((await h.store.getPage(D))?.status, 'ok');
  assert.equal(h.fake.count(`GET /v1/pages/${D}`), 1);
  h.clock.t += 3_600_000;
  h.fake.calls.length = 0;
  await crawlAll(h);
  assert.equal(h.fake.count(`GET /v1/pages/${D}`), 1);
});

test('읽을 수 없는 페이지는 표시하고 계속한다(F-5)', async () => {
  const h = harness();
  const hidden = uid(50);
  const pageD = h.fake.pages.get(D);
  assert.ok(pageD);
  pageD.blocks = [paragraph('d1', mention(hidden))];
  h.fake.inject(`/v1/pages/${hidden}`, { status: 403, body: { code: 'restricted_resource' } });
  await crawlAll(h);
  const record = await h.store.getPage(hidden);
  assert.equal(record?.status, 'unreadable');
  assert.equal(record?.unreadableReason, 'forbidden');
  const graph = buildGraph(await h.store.listPages(), await h.store.allLinks(), { hierarchy: false });
  assert.equal(graph.nodes.find((node) => node.id === hidden)?.unreadable, true);
  assert.equal((await h.store.getPage(A))?.status, 'ok');
});

test('relation이 25개를 넘으면 속성 항목으로 나머지를 읽는다', async () => {
  const h = harness();
  const targets = Array.from({ length: 30 }, (_, i) => uid(200 + i));
  h.fake.add({ id: uid(150), title: 'X', parent: childOf(ROOT), edited: OLD, blocks: [], relation: targets });
  await crawlAll(h);
  assert.deepEqual(await targetsOf(h, uid(150)), [...targets].sort());
  assert.ok(h.fake.count(`GET /v1/pages/${uid(150)}/properties`) >= 1);
});

test('토큰 오류(401)는 멈추고 이유를 알려 준다(F-8)', async () => {
  const h = harness();
  h.fake.inject('/v1/search', { status: 401, body: { code: 'unauthorized' } });
  await beginCrawl(h.store, h.deps.now);
  assert.deepEqual(await runCrawl(h.deps, Infinity), { kind: 'error', reason: 'token', message: '토큰이 맞지 않아요. 만료됐거나 잘못 복사됐을 수 있어요' });
});

test('한 페이지가 5xx로 실패해도 색인은 끝나고, 다음 색인에서 다시 읽는다(F-8)', async () => {
  const h = harness(buildWorld(), { retry: true });
  const bad = { status: 503, body: { code: 'service_unavailable' } };
  h.fake.inject(`/v1/blocks/${B}/`, bad, bad, bad);
  await crawlAll(h);
  const failed = await h.store.getPage(B);
  assert.equal(failed?.status, 'pending');
  assert.equal(failed?.failCount, 1);
  h.clock.t += 3_600_000;
  await crawlAll(h);
  assert.equal((await h.store.getPage(B))?.status, 'ok');
  assert.equal((await h.store.getPage(B))?.failCount, 0);
});

test('계속 실패하는 페이지는 4번째에 읽을 수 없음(error)으로 바꾸고 글자도 지운다', async () => {
  const h = harness(buildWorld(), { retry: true });
  await crawlAll(h);
  assert.ok(h.store.texts.has(B), '처음엔 읽혀서 글자가 있다');
  const pageB = h.fake.pages.get(B);
  assert.ok(pageB);
  const bad = { status: 503, body: { code: 'service_unavailable' } };
  for (let run = 0; run < 4; run += 1) {
    h.clock.t += 3_600_000;
    pageB.edited = new Date(h.clock.t).toISOString();
    h.fake.inject(`/v1/blocks/${B}/`, bad, bad, bad);
    await crawlAll(h);
  }
  const record = await h.store.getPage(B);
  assert.equal(record?.status, 'unreadable');
  assert.equal(record?.unreadableReason, 'error');
  assert.equal(h.store.texts.has(B), false);
});

test('본문 글자를 연결과 함께 저장하고, 요청 수는 기능 전과 같다(F-16, NF-11)', async () => {
  const fake = buildWorld();
  const pageD = fake.pages.get(D);
  assert.ok(pageD);
  pageD.blocks = [
    paragraph('d1', { type: 'text', text: { content: '회의록 참고', link: null }, plain_text: '회의록 참고' }, mention(A)),
    { id: 'd2', type: 'code', code: { rich_text: [{ type: 'text', plain_text: '회의록' }] } },
  ];
  const h = harness(fake);
  await crawlAll(h);
  // 기능 전 코드에서 같은 데이터로 잰 값: 처음 14번, A만 고친 다시 만들기 3번
  assert.equal(h.fake.calls.length, 14);
  assert.equal(h.store.texts.get(D), '회의록 참고', '@언급 글자와 코드 블록은 빼고');
  assert.equal(h.store.texts.has(E), false, '글자가 없는 페이지는 저장하지 않는다');
  assert.equal((await h.store.getPage(D))?.textVersion, 1);
  h.clock.t += 3_600_000;
  const pageA = h.fake.pages.get(A);
  assert.ok(pageA);
  pageA.edited = '2026-11-13T08:30:00.000Z';
  h.fake.calls.length = 0;
  await crawlAll(h);
  assert.equal(h.fake.calls.length, 3);
});

test('글자를 모은 적 없는 지도는 다음 다시 만들기에서 한 번만 전체를 다시 읽는다(F-17)', async () => {
  const h = harness();
  await crawlAll(h);
  const firstBlockReads = h.fake.count('GET /v1/blocks/');
  // 업데이트 전 지도처럼 글자와 버전을 지운다
  for (const page of h.store.pages.values()) delete page.textVersion;
  h.store.texts.clear();
  h.clock.t += 3_600_000;
  h.fake.calls.length = 0;
  await crawlAll(h);
  assert.equal(h.fake.count('GET /v1/blocks/'), firstBlockReads, '처음 만들 때처럼 모든 페이지의 본문을 다시 읽는다');
  assert.ok(h.store.texts.size > 0);
  for (let run = 0; run < 2; run += 1) {
    h.clock.t += 3_600_000;
    h.fake.calls.length = 0;
    await crawlAll(h);
    assert.deepEqual(h.fake.calls, ['POST /v1/search'], `다시 읽은 뒤 ${run + 1}번째`);
  }
});

test('읽을 수 없게 되거나 지워진 페이지의 글자, 저장된 데이터 지우기는 글자도 지운다(F-16)', async () => {
  const fake = buildWorld();
  for (const id of [D, E]) {
    const target = fake.pages.get(id);
    assert.ok(target);
    target.blocks = [paragraph(`${id}-t`, { type: 'text', plain_text: '글자' })];
  }
  const h = harness(fake);
  await crawlAll(h);
  assert.ok(h.store.texts.has(D) && h.store.texts.has(E));
  h.clock.t += 3_600_000;
  h.fake.pages.delete(D);
  const pageE = h.fake.pages.get(E);
  assert.ok(pageE);
  pageE.inTrash = true;
  await crawlAll(h);
  assert.equal(h.store.texts.has(D), false, '접근을 잃은 페이지');
  assert.equal(h.store.texts.has(E), false, '휴지통에 간 페이지');
  await h.store.clear();
  assert.deepEqual(await h.store.listTexts(), []);
});
