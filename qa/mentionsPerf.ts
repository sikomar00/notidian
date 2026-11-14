// node qa/mentionsPerf.ts — 연결 안 된 언급 찾기 속도(NF-8). 가짜 페이지(페이지당 글자 3,000자, 20줄)에서 페이지 하나를 고를 때 걸리는 시간
import { buildMatcher, findAllMentions } from '../src/graph/mentionIndex.ts';
import { findUnlinkedMentions, prepareTexts } from '../src/graph/unlinkedMentions.ts';
import type { StoredText } from '../src/graph/types.ts';

const WORDS = ['회의록', '프로젝트', '디자인', '일정', '검토', 'API', 'release', '고객', '지표', '정리', '다음 주', '결정'];

function fakePages(count: number): StoredText[] {
  return Array.from({ length: count }, (_, index) => {
    const lines = Array.from({ length: 20 }, (_, line) => {
      let text = '';
      for (let word = index + line; text.length < 150; word += 7) text += `${WORDS[word % WORDS.length]} `;
      return text;
    });
    return { id: `p${index}`, text: lines.join('\n') };
  });
}

for (const [count, limitMs] of [[500, 500], [2000, 2000]] as const) {
  // 준비(NFC·소문자)는 글자를 불러올 때 한 번이라 따로 잰다. 페이지를 고를 때마다 드는 시간은 찾기뿐이다
  const loadStart = performance.now();
  const pages = prepareTexts(fakePages(count), (id) => `제목 ${id}`);
  const prepareMs = performance.now() - loadStart;
  const runs = ['회의록', '제목 p12', 'release'].map((title) => {
    const start = performance.now();
    const result = findUnlinkedMentions({ id: 'p0', title }, pages, new Set());
    return { ms: performance.now() - start, found: result === 'too-short' ? 0 : result.length };
  });
  const worst = Math.max(...runs.map((run) => run.ms));
  const total = prepareMs + worst;
  console.log(
    `${count}페이지: 준비 ${prepareMs.toFixed(1)}ms(불러올 때 한 번) + 가장 느린 찾기 ${worst.toFixed(1)}ms = ${total.toFixed(1)}ms ` +
      `(목표 ${limitMs}ms 이내) ${total <= limitMs ? '통과' : '실패'} · 찾은 페이지 ${runs.map((run) => run.found).join('/')}`,
  );
}

// 언급 정리(NF-13): 모든 제목을 한 번에 찾는 전체 계산. 화면은 50페이지씩 나눠 계산하므로 한 조각의 최장 시간도 잰다(0.2초)
for (const [count, limitMs] of [[500, 1000], [2000, 5000]] as const) {
  const start = performance.now();
  const texts = fakePages(count);
  // 제목 일부는 본문 단어와 같게 해서 실제로 찾을 것이 있게 한다
  const titleOf = (id: string) => (Number(id.slice(1)) % 10 === 0 ? WORDS[Number(id.slice(1)) % WORDS.length] : `제목 ${id}`);
  const pages = prepareTexts(texts, titleOf);
  const matcher = buildMatcher(texts.map(({ id }) => ({ id, title: titleOf(id) ?? '' })));
  let slowestSlice = 0;
  let groups = 0;
  for (let from = 0; from < pages.length; from += 50) {
    const sliceStart = performance.now();
    groups += findAllMentions(pages.slice(from, from + 50), matcher, () => new Set()).length;
    slowestSlice = Math.max(slowestSlice, performance.now() - sliceStart);
  }
  const totalMs = performance.now() - start;
  const ok = totalMs <= limitMs && slowestSlice <= 200;
  console.log(`언급 정리 ${count}페이지: 전체 ${totalMs.toFixed(0)}ms(목표 ${limitMs}ms), 가장 긴 50페이지 조각 ${slowestSlice.toFixed(0)}ms(목표 200ms) ${ok ? '통과' : '실패'} · 묶음 ${groups}개`);
}
