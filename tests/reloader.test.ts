import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReloader, graphSignature } from '../src/extension/graph-view/reloader.ts';
import type { PageRecord, RawLink } from '../src/graph/types.ts';

const page = (id: string, extra: Partial<PageRecord> = {}): PageRecord => ({ id, title: id, kind: 'page', url: '', lastEdited: '', status: 'ok', failCount: 0, ...extra });

test('다시 읽기: 보이는 것이 그대로면 넘기지 않고, 주소·상위·소속 DB가 바뀌면 넘긴다', async () => {
  let data: [PageRecord[], RawLink[]] = [[page('a')], []];
  const received: number[] = [];
  const reloader = createReloader({ read: async () => data, onData: (pages) => received.push(pages.length), onError: (error) => assert.fail(String(error)) });
  await reloader.reload();
  await reloader.reload();
  assert.deepEqual(received, [1]);
  data = [[page('a', { url: 'https://app.notion.com/p/a' })], []];
  await reloader.reload();
  assert.deepEqual(received, [1, 1]);
  // 항목 사이 구분자가 있어 상위 페이지와 소속 DB가 서로 섞여도 같은 값이 되지 않는다
  assert.notEqual(graphSignature([page('a', { parentPageId: 'x' })], []), graphSignature([page('a', { databaseId: 'x' })], []));
});

test('다시 읽기: 늦게 끝난 옛 읽기는 버리고, 실패는 알리며, 그리기에 실패하면 다음에 다시 그린다', async () => {
  const pending: ((value: [PageRecord[], RawLink[]]) => void)[] = [];
  const received: string[] = [];
  const errors: unknown[] = [];
  let failNext = false;
  const reloader = createReloader({
    read: () => new Promise((done) => pending.push(done)),
    onData: (pages) => {
      if (failNext) {
        failNext = false;
        throw new Error('그리기 실패');
      }
      received.push(pages[0]?.id ?? '');
    },
    onError: (error) => errors.push(error),
  });
  const older = reloader.reload();
  const newer = reloader.reload();
  pending[1]?.([[page('new')], []]);
  pending[0]?.([[page('old')], []]);
  await Promise.all([older, newer]);
  assert.deepEqual(received, ['new']);

  failNext = true;
  const broken = reloader.reload();
  pending[2]?.([[page('b')], []]);
  await broken;
  assert.equal(errors.length, 1);
  const retry = reloader.reload();
  pending[3]?.([[page('b')], []]);
  await retry;
  assert.deepEqual(received, ['new', 'b']);
});
