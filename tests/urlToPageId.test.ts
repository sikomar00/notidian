import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeId, urlToPageId } from '../src/notion/urlToPageId.ts';

const HEX = '123456789abc4def8123456789abcdef';
const UUID = '12345678-9abc-4def-8123-456789abcdef';

test('슬러그 뒤 32자리를 UUID로 바꾼다', () => {
  assert.equal(urlToPageId(`https://app.notion.com/Avocado-${HEX}`), UUID);
  assert.equal(urlToPageId(`https://www.notion.so/team/Avocado-${HEX}`), UUID);
});

test('슬러그 없는 주소와 /p/ 형태', () => {
  assert.equal(urlToPageId(`https://notion.so/${HEX}`), UUID);
  assert.equal(urlToPageId(`https://app.notion.com/p/${HEX}`), UUID);
});

test('하이픈 UUID, 끝 슬래시, #블록 조각', () => {
  assert.equal(urlToPageId(`https://app.notion.com/${UUID}`), UUID);
  assert.equal(urlToPageId(`https://app.notion.com/x-${HEX}/`), UUID);
  assert.equal(urlToPageId(`https://app.notion.com/x-${HEX}#abc123`), UUID);
});

test('대문자 ID도 소문자로 맞춘다', () => {
  assert.equal(urlToPageId(`https://app.notion.com/x-${HEX.toUpperCase()}`), UUID);
});

test('다른 호스트·http·?p= 형태·쓰레기는 null', () => {
  assert.equal(urlToPageId(`https://evil.com/${HEX}`), null);
  assert.equal(urlToPageId(`https://notion.so.evil.com/${HEX}`), null);
  assert.equal(urlToPageId(`http://app.notion.com/${HEX}`), null);
  assert.equal(urlToPageId(`https://app.notion.com/workspace?p=${HEX}`), null);
  assert.equal(urlToPageId('not a url'), null);
});

test('긴 16진수 문자열의 뒷부분만 잘라 쓰지 않는다', () => {
  assert.equal(urlToPageId(`https://app.notion.com/ab${HEX}`), null);
});

test('normalizeId', () => {
  assert.equal(normalizeId(HEX), UUID);
  assert.equal(normalizeId(UUID.toUpperCase()), UUID);
  assert.equal(normalizeId('짧다'), null);
});
