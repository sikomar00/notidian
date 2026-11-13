import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followedPage } from '../src/extension/graph-view/follow.ts';

const HEX = '1a2b3c4d5e6f70818293a4b5c6d7e8f9';
const ID = '1a2b3c4d-5e6f-7081-8293-a4b5c6d7e8f9';
const tab = { id: 7, windowId: 1, active: true, url: `https://app.notion.com/p/Roadmap-${HEX}` };

test('따라가기: 같은 창에서 보이는 Notion 페이지 탭만 따라간다(P1-4)', () => {
  assert.equal(followedPage(tab, 1), ID);
  // 다른 창, 뒤에 있는 탭, 창을 아직 모름, Notion 페이지가 아닌 주소, 주소를 못 보는 탭은 따라가지 않는다
  assert.equal(followedPage(tab, 2), null);
  assert.equal(followedPage({ ...tab, active: false }, 1), null);
  assert.equal(followedPage(tab, undefined), null);
  assert.equal(followedPage({ ...tab, url: 'https://app.notion.com/' }, 1), null);
  assert.equal(followedPage({ ...tab, url: `https://example.com/p/${HEX}` }, 1), null);
  assert.equal(followedPage({ ...tab, url: undefined }, 1), null);
});
