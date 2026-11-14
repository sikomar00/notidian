// 왜 연결됐나(연결 근거, F-28·F-29)와 경로 찾기(F-31·F-32) 점검. 예시 데이터의 근거를 쓴다
import { NO_HSCROLL, q } from './fixtures.ts';
import { expect, waitFor } from './harness.ts';
import type { Browser, Check, Page } from './harness.ts';
import { pick } from './graphScenarios.ts';

const lineOf = (list: string, title: string): string =>
  q(`[...$('${list}').children].find((li) => li.querySelector('button')?.textContent === ${JSON.stringify(title)})?.querySelector('.evidence')?.textContent ?? ''`);
const NOTE = q(`$('path-note').textContent`);
const STEPS = q(`[...$('path-result').children].map((li) => li.textContent).join(' | ')`);

async function findPath(page: Page, text: string): Promise<void> {
  await page.run(`(() => { const s = document.getElementById('path-search'); s.value = ''; s.focus(); })()`);
  await page.type(text);
  await waitFor(page, `document.getElementById('path-search').getAttribute('aria-expanded') === 'true'`);
  await page.press('Enter');
}

export async function linkEvidenceAndPath(browser: Browser, check: Check): Promise<void> {
  const demo = await browser.open(browser.ext('graph.html?mode=full&demo=1'));
  await waitFor(demo, `!!document.querySelector('#graph canvas')`);
  await pick(demo, '프로젝트 A');
  await expect(check, demo, '근거: 보낸 연결에 @언급과 앞뒤 글자', `${lineOf('sel-out', 'API 명세')} === '@언급 “자세한 요청·응답은 API 명세를 따른다”'`, lineOf('sel-out', 'API 명세'));
  await expect(check, demo, '근거: 받은 연결에 relation과 속성 이름', `${lineOf('sel-in', '11월 1주 회의')} === 'relation · 속성 "관련 문서"'`, lineOf('sel-in', '11월 1주 회의'));
  await expect(check, demo, '근거: 찾은 글자는 굵게', `[...document.querySelectorAll('#sel-out .evidence strong')].some((s) => s.textContent === 'API 명세')`);
  await findPath(demo, '지표');
  await expect(check, demo, '경로: 단계 수와 길, 단계마다 근거(키보드 Enter)', `${NOTE} === '2단계로 이어져요' && ${STEPS}.startsWith('프로젝트 A 기획 | ↓ 앞 페이지가 가리킴: 연결로드맵 2027 | ') && ${STEPS}.endsWith('링크 “성과는 지표 대시보드에서 본다”지표 대시보드')`, STEPS);
  await demo.shot('path');
  // 그래프가 바뀌면 길을 다시 구한다: 주변 1단계만 그리면 길 일부가 안 보인다고 알린다
  await demo.run(`(() => { document.getElementById('local-depth').value = '1'; document.getElementById('local').click(); })()`);
  await expect(check, demo, '경로: 주변만 보기로 바꾸면 길 일부가 안 보인다고 알림', `${NOTE} === '2단계로 이어져요. 주변만 보는 중이라 길 일부는 그래프에 안 보여요'`, NOTE);
  await demo.run(`document.getElementById('local').click()`);
  await expect(check, demo, '경로: 다시 전체를 보면 알림이 사라짐', `${NOTE} === '2단계로 이어져요'`, NOTE);
  await findPath(demo, '메모');
  await expect(check, demo, '경로: 이어지지 않으면 안내', `${NOTE} === '6단계 안에 이어지는 길이 없어요' && document.getElementById('path-result').children.length === 0`, NOTE);
  await pick(demo, '로드맵');
  await expect(check, demo, '경로: 다른 페이지를 고르면 지움', `${NOTE} === '' && document.getElementById('path-search').value === '' && document.getElementById('path-clear').hidden`, NOTE);
  demo.close();

  const narrow = await browser.open(browser.ext('graph.html?mode=side&demo=1'), { width: 360, height: 800 });
  await waitFor(narrow, `!!document.querySelector('#graph canvas')`);
  await pick(narrow, '프로젝트 A');
  await findPath(narrow, '지표');
  await expect(check, narrow, '경로: 360px에서 가로 넘침 없음', `${NOTE} === '2단계로 이어져요' && ${NO_HSCROLL}`, NOTE);
  await narrow.run(`document.getElementById('path').scrollIntoView()`);
  await narrow.shot('path-360');
}
