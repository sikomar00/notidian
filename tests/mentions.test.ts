import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findUnlinkedMentions, prepareTexts } from '../src/graph/unlinkedMentions.ts';
import type { PreparedText } from '../src/graph/unlinkedMentions.ts';
import { blockText, MAX_TEXT, pageText } from '../src/notion/extractText.ts';
import { mention, uid } from './helpers/fakeNotion.ts';

const plain = (text: string) => ({ type: 'text', text: { content: text, link: null }, plain_text: text });
const rich = (type: string, ...items: unknown[]) => ({ id: type, type, [type]: { rich_text: items } });

test('본문 글자: 모으는 블록의 글자, @언급 글자는 빼고, 코드·하위 페이지는 빼고, 표 칸은 공백으로(F-16)', () => {
  for (const type of ['paragraph', 'heading_1', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout']) {
    assert.equal(blockText(rich(type, plain('회의록 정리'))), '회의록 정리', type);
  }
  assert.equal(blockText(rich('paragraph', plain('지난 '), mention(uid(1)), plain(' 참고'))), '지난  참고');
  assert.equal(blockText(rich('code', plain('회의록'))), '');
  assert.equal(blockText({ id: 'c', type: 'child_page', child_page: { title: '회의록' } }), '');
  assert.equal(blockText({ id: 't', type: 'table_row', table_row: { cells: [[plain('가')], [plain('나'), plain('다')]] } }), '가 나다');
  assert.equal(blockText(rich('paragraph', plain('첫 줄\n둘째 줄'))), '첫 줄 둘째 줄');
  assert.equal(blockText(null), '');
  assert.equal(pageText([rich('paragraph', plain('하나')), rich('paragraph'), rich('quote', plain('둘'))]), '하나\n둘');
  assert.equal(pageText([rich('paragraph', plain('가'.repeat(MAX_TEXT + 5)))]).length, MAX_TEXT);
  // 한도에서 두 칸짜리 글자(이모지)가 반으로 잘리면 그 글자를 뺀다
  assert.equal(pageText([rich('paragraph', plain(`${'가'.repeat(MAX_TEXT - 1)}😀`))]), '가'.repeat(MAX_TEXT - 1));
});

const page = (id: string, text: string, title = id): PreparedText => prepareTexts([{ id, text }], () => title)[0] as PreparedText;
const ids = (result: ReturnType<typeof findUnlinkedMentions>) => (result === 'too-short' ? result : result.map((m) => m.id));

test('찾기: 한글은 조사가 붙어도, 라틴 문자는 단어 경계에서만, 대소문자 무시(F-18)', () => {
  const pages = [
    page('ko', '지난주 회의록에서 정한 대로'),
    page('art', 'start the engine'),
    page('artok', 'Modern ART, art.'),
    page('mixed', 'Q4 회의는 Q40 회의와 달라'),
  ];
  assert.deepEqual(ids(findUnlinkedMentions({ id: 't', title: '회의록' }, pages, new Set())), ['ko']);
  const art = findUnlinkedMentions({ id: 't', title: 'Art' }, pages, new Set());
  assert.deepEqual(ids(art), ['artok']);
  assert.equal(art !== 'too-short' && art[0]?.count, 2);
  const q4 = findUnlinkedMentions({ id: 't', title: 'Q4 회의' }, pages, new Set());
  assert.equal(q4 !== 'too-short' && q4[0]?.count, 1, 'Q40 회의는 경계가 아니다');
  // NFD로 적힌 글자도 찾는다(맥에서 붙여 넣은 한글 등)
  assert.deepEqual(ids(findUnlinkedMentions({ id: 't', title: '회의록' }, [page('nfd', '회의록'.normalize('NFD'))], new Set())), ['nfd']);
});

test('찾기: 자기 자신·이미 연결된 페이지·짧거나 없는 제목은 빼고, 줄을 넘어 찾지 않는다(F-18)', () => {
  const pages = [page('t', '회의록 회의록'), page('linked', '회의록'), page('split', '회의\n록'), page('ok', '회의록')];
  assert.deepEqual(ids(findUnlinkedMentions({ id: 't', title: '회의록' }, pages, new Set(['linked']))), ['ok']);
  for (const title of ['', '  ', '메모', '제목 없음', 'Untitled']) {
    assert.equal(findUnlinkedMentions({ id: 't', title }, pages, new Set()), 'too-short', title);
  }
});

test('결과: 앞뒤 30자와 "…", 처음 나온 곳, 많은 순 → 제목 순(F-19)', () => {
  const long = `${'가'.repeat(40)}회의록${'나'.repeat(40)}\n두 번째 회의록`;
  const result = findUnlinkedMentions(
    { id: 't', title: '회의록' },
    [page('b', '회의록', '나 페이지'), page('long', long, '긴 페이지'), page('a', '회의록', '가 페이지')],
    new Set(),
  );
  assert.ok(result !== 'too-short');
  assert.deepEqual(result.map((m) => m.title), ['긴 페이지', '가 페이지', '나 페이지']);
  assert.deepEqual(result[0], { id: 'long', title: '긴 페이지', count: 2, before: `…${'가'.repeat(30)}`, match: '회의록', after: `${'나'.repeat(30)}…` });
  assert.deepEqual(result[1], { id: 'a', title: '가 페이지', count: 1, before: '', match: '회의록', after: '' });
  // 찾은 글자는 원문 그대로(대소문자) 돌려준다
  const cased = findUnlinkedMentions({ id: 't', title: 'notion' }, [page('x', 'I like Notion!')], new Set());
  assert.ok(cased !== 'too-short');
  assert.deepEqual([cased[0]?.before, cased[0]?.match, cased[0]?.after], ['I like ', 'Notion', '!']);
});
