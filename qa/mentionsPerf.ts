// node qa/mentionsPerf.ts — 연결 안 된 언급 찾기 속도(NF-8). 가짜 페이지(페이지당 글자 3,000자, 20줄)에서 페이지 하나를 고를 때 걸리는 시간
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
