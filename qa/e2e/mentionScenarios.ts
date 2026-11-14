// 연결 안 된 언급 칸(S2-7, F-19~F-22) 점검. 저장된 가짜 지도에는 본문 글자가 없고, 예시 모드에는 가짜 본문이 있다
import { NO_HSCROLL, q } from './fixtures.ts';
import { expect, waitFor } from './harness.ts';
import type { Browser, Check } from './harness.ts';
import { openGraph, pick } from './graphScenarios.ts';

const NOTE = q(`$('mentions-note').textContent`);
const TITLE = q(`$('mention-title').textContent`);
const ROWS = q(`[...$('sel-mentions').children].map((li) => li.textContent).join(' | ')`);

export async function unlinkedMentions(browser: Browser, check: Check): Promise<void> {
  const seeded = await openGraph(browser);
  await pick(seeded, '로드');
  await expect(check, seeded, '언급: 본문을 모은 적 없으면 다시 만들기 안내', `${NOTE} === '다시 만들기를 하면 보여요'`, NOTE);
  seeded.close();

  const demo = await browser.open(browser.ext('graph.html?mode=full&demo=1'));
  await waitFor(demo, `!!document.querySelector('#graph canvas')`);
  await pick(demo, '디자인 시');
  await expect(check, demo, '언급: 제목과 개수(이미 연결된 디자인 리뷰는 빠짐)', `${TITLE} === '연결 안 된 언급 2개'`, TITLE);
  await expect(check, demo, '언급: 많이 나온 순, 앞뒤 글자와 횟수', `${ROWS} === '주간 회고 · 2곳“이번 주에는 디자인 시스템의 버튼 색을 정리했다” | 11월 2주 회의 · 1곳“로그인 화면은 디자인 시스템 규칙을 따른다”'`, ROWS);
  await expect(check, demo, '언급: 찾은 글자만 굵게', `document.querySelector('#sel-mentions strong')?.textContent === '디자인 시스템'`);
  await demo.run(`document.querySelector('#sel-mentions button').focus()`);
  await demo.press('Enter');
  await expect(check, demo, '언급: 키보드 Enter로 열기(예시는 안내만)', `document.getElementById('notice').textContent.includes('예시 페이지라')`, `document.getElementById('notice').textContent`);
  await demo.shot('mentions');
  await pick(demo, '경쟁사');
  await expect(check, demo, '언급: 결과가 없으면 안내', `${NOTE} === '글자로만 적은 곳이 없어요' && ${TITLE} === '연결 안 된 언급 0개'`, NOTE);
  await pick(demo, '메모');
  await expect(check, demo, '언급: 짧은 제목은 찾지 않는다는 안내', `${NOTE} === '제목이 너무 짧아서 찾지 않아요' && $('sel-mentions').children.length === 0`.replaceAll('$(', 'document.getElementById('), NOTE);
  demo.close();

  const narrow = await browser.open(browser.ext('graph.html?mode=side&demo=1'), { width: 360, height: 800, scheme: 'light' });
  await waitFor(narrow, `!!document.querySelector('#graph canvas')`);
  await pick(narrow, '디자인 시');
  const stacked = `document.getElementById('mentions').getBoundingClientRect().top >= document.getElementById('out-title').closest('section').getBoundingClientRect().bottom`;
  await expect(check, narrow, '언급: 360px에서 아래로 쌓이고 가로 넘침 없음', `${stacked} && ${NO_HSCROLL}`);
  await narrow.run(`document.getElementById('mentions').scrollIntoView()`);
  await narrow.shot('mentions-360');
}
