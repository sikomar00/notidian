import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractFromBlock, extractFromProperties } from '../src/notion/extractLinks.ts';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const hex = (id: string) => id.replaceAll('-', '');

const text = (content: string, url: string | null = null) => ({
  type: 'text',
  text: { content, link: url ? { url } : null },
  plain_text: content,
  href: url,
});
const pageMention = (id: string) => ({
  type: 'mention',
  mention: { type: 'page', page: { id } },
  plain_text: '제목',
  href: `https://app.notion.com/x-${hex(id)}`,
});
const paragraph = (...richText: unknown[]) => ({
  type: 'paragraph',
  has_children: false,
  paragraph: { rich_text: richText },
});

test('@페이지 언급', () => {
  assert.deepEqual(extractFromBlock(paragraph(pageMention(A))), [A]);
});

test('본문 속 Notion 링크: 텍스트 링크와 링크 멘션', () => {
  const linkMention = {
    type: 'mention',
    mention: { type: 'link_mention', link_mention: { href: `https://www.notion.so/${hex(B)}` } },
    plain_text: '링크',
    href: null,
  };
  const block = paragraph(text('글', `https://app.notion.com/y-${hex(A)}`), linkMention);
  assert.deepEqual(extractFromBlock(block).sort(), [A, B]);
});

test('Notion이 아닌 링크는 무시한다', () => {
  assert.deepEqual(extractFromBlock(paragraph(text('글', `https://example.com/${hex(A)}`))), []);
});

test('"페이지로 연결" 블록은 page_id만', () => {
  const link = (payload: unknown) => ({ type: 'link_to_page', link_to_page: payload });
  assert.deepEqual(extractFromBlock(link({ type: 'page_id', page_id: A })), [A]);
  assert.deepEqual(extractFromBlock(link({ type: 'database_id', database_id: B })), []);
  assert.deepEqual(extractFromBlock(link({ type: 'comment_id', comment_id: C })), []);
});

test('child_page·child_database는 연결이 아니다', () => {
  assert.deepEqual(extractFromBlock({ type: 'child_page', child_page: { title: '하위' } }), []);
  assert.deepEqual(extractFromBlock({ type: 'child_database', child_database: { title: 'DB' } }), []);
});

test('표 칸·캡션처럼 묻혀 있는 멘션도 찾는다', () => {
  const row = { type: 'table_row', table_row: { cells: [[text('a')], [pageMention(A)]] } };
  assert.deepEqual(extractFromBlock(row), [A]);
  const image = { type: 'image', image: { caption: [pageMention(B)], external: { url: 'https://x.com/a.png' } } };
  assert.deepEqual(extractFromBlock(image), [B]);
});

test('같은 대상을 여러 번 가리켜도 한 번만', () => {
  assert.deepEqual(extractFromBlock(paragraph(pageMention(A), pageMention(A))), [A]);
});

test('알 수 없는 블록 모양에도 오류 없이 빈 결과', () => {
  assert.deepEqual(extractFromBlock(null), []);
  assert.deepEqual(extractFromBlock({ type: 'divider', divider: {} }), []);
  assert.deepEqual(extractFromBlock({ type: 42 }), []);
});

test('relation 속성과 제목 속 @언급', () => {
  const properties = {
    관련: { type: 'relation', relation: [{ id: A }, { id: B }], has_more: false },
    이름: { type: 'title', title: [pageMention(C)] },
    숫자: { type: 'number', number: 3 },
  };
  assert.deepEqual(extractFromProperties(properties).sort(), [A, B, C]);
});

test('속성이 없거나 모양이 달라도 빈 결과', () => {
  assert.deepEqual(extractFromProperties(undefined), []);
  assert.deepEqual(extractFromProperties({ x: 'text' }), []);
});
