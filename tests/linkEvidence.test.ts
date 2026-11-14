import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceFromBlocks, evidenceFromProperties, mergeEvidence } from '../src/notion/linkEvidence.ts';
import { hex, link, mention, paragraph, uid } from './helpers/fakeNotion.ts';

const plain = (text: string) => ({ type: 'text', text: { content: text, link: null }, plain_text: text });
const notionUrl = (id: string) => `https://app.notion.com/p/${hex(id)}`;

test('연결 근거: @언급은 앞뒤 글자와 함께, 링크는 링크로, 페이지로 연결 블록은 종류만(F-28·F-29)', () => {
  const [A, B, C] = [uid(1), uid(2), uid(3)];
  const evidence = evidenceFromBlocks([
    paragraph('p1', plain('지난주 '), mention(A), plain(' 회의에서 정한 대로')),
    paragraph('p2', plain('자세한 건 '), link(notionUrl(B)), plain(' 참고')),
    { id: 'l', type: 'link_to_page', link_to_page: { type: 'page_id', page_id: C } },
    paragraph('p3', plain('다시 '), mention(A)),
    { id: 'c', type: 'child_page', child_page: { title: '하위' } },
  ]);
  // fakeNotion의 mention은 plain_text가 '제목', link는 '링크'다
  assert.deepEqual(evidence.get(A), { kinds: ['mention'], before: '지난주 ', match: '제목', after: ' 회의에서 정한 대로' }, '@언급에 붙은 주소는 링크로 세지 않고, 처음 나온 곳만');
  assert.deepEqual(evidence.get(B), { kinds: ['link'], before: '자세한 건 ', match: '링크', after: ' 참고' });
  assert.deepEqual(evidence.get(C), { kinds: ['linkToPage'] });
  assert.equal(evidence.size, 3);
});

test('연결 근거: relation과 제목·텍스트 속성은 속성 이름, 본문과 합치면 종류를 모두 모은다(F-28)', () => {
  const [A, B] = [uid(1), uid(2)];
  const props = evidenceFromProperties({
    '관련 프로젝트': { type: 'relation', relation: [{ id: A }] },
    메모: { type: 'rich_text', rich_text: [plain('참고: '), mention(B)] },
    상태: { type: 'select', select: { name: '완료' } },
  });
  assert.deepEqual(props.get(A), { kinds: ['relation'], property: '관련 프로젝트' });
  assert.deepEqual(props.get(B), { kinds: ['mention'], property: '메모', before: '참고: ', match: '제목', after: '', quoteProperty: '메모' });
  const merged = mergeEvidence(props, evidenceFromBlocks([paragraph('p', plain('또 '), mention(A))]));
  assert.deepEqual(merged.get(A), { kinds: ['relation', 'mention'], property: '관련 프로젝트', before: '또 ', match: '제목', after: '' }, '속성 이름과 본문 글자(출처 표시 없음 = 본문)');
});

test('연결 근거: 속성 이름과 다른 곳의 문장은 출처를 따로 적고, 이모지를 반으로 자르지 않는다(F-29)', () => {
  const [A, B] = [uid(1), uid(2)];
  const props = evidenceFromProperties({
    관련: { type: 'relation', relation: [{ id: A }] },
    메모: { type: 'rich_text', rich_text: [plain('메모에서 '), mention(A)] },
  });
  assert.deepEqual(props.get(A), { kinds: ['relation', 'mention'], property: '관련', before: '메모에서 ', match: '제목', after: '', quoteProperty: '메모' }, '문장은 "메모" 속성에서 나왔다');
  const party = '\u{1F389}';
  const emoji = evidenceFromBlocks([paragraph('p', plain(`${'가'.repeat(28)}${party}`), mention(B), plain(`${party}${'나'.repeat(28)}`))]).get(B);
  assert.equal(emoji?.before, `${'가'.repeat(28)}${party}`, '앞 30칸 안의 이모지는 온전히');
  assert.equal(emoji?.after, `${party}${'나'.repeat(28)}`, '뒤 30칸 안의 이모지도 온전히');
  const cut = evidenceFromBlocks([paragraph('q', plain(`${party}${'가'.repeat(29)}`), mention(B))]).get(B);
  assert.equal(cut?.before, `…${'가'.repeat(29)}`, '30칸 경계에 걸린 이모지 반쪽은 버린다');
});
