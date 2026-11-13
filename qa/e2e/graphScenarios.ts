// 설정 화면·그래프 화면 기본 동작 점검(P0~P2-2에서 화면으로 확인한 것들)
import { NO_HSCROLL, PANEL, q, SEED_SAMPLE } from './fixtures.ts';
import { expect, sleep, waitFor } from './harness.ts';
import type { Browser, Check, Page } from './harness.ts';

const STEPS = q(`[...$('steps').children].map((li) => li.dataset.state).join(',')`);
const panelIs = (text: string | null): string => `${PANEL} === ${JSON.stringify(text)}`;
const panelStarts = (title: string): string => `String(${PANEL}).startsWith(${JSON.stringify(`${title} /`)})`;

/** 제목 검색에 입력하고 Enter로 첫 후보를 고른다. */
export async function pick(page: Page, text: string): Promise<void> {
  await page.run(`(() => { const s = document.getElementById('search'); s.value = ''; s.focus(); })()`);
  await page.type(text);
  await waitFor(page, `document.getElementById('search').getAttribute('aria-expanded') === 'true'`);
  await page.press('Enter');
}

export async function openGraph(browser: Browser, mode = 'full'): Promise<Page> {
  const page = await browser.open(browser.ext(`graph.html?mode=${mode}`));
  if (!(await waitFor(page, `!!document.querySelector('#graph canvas') && document.getElementById('empty').hidden`))) throw new Error('그래프가 그려지지 않았어요');
  return page;
}

/** 첫 실행 준비 단계를 보고, 가짜 색인을 넣는다(이후 점검의 공통 데이터). */
export async function optionsAndSeed(browser: Browser, check: Check): Promise<void> {
  const page = await browser.open(browser.ext('options.html'));
  if (!(await waitFor(page, `document.getElementById('steps')?.children.length > 0`))) throw new Error('설정 화면이 뜨지 않았어요');
  // 점검 중에는 실제 Notion에 닿지 않아야 한다(가짜 토큰이 서비스 워커에서 나가도 주소를 찾지 못한다)
  const reached = await page.run(`fetch('https://api.notion.com/v1/users/me').then(() => 'reached', (error) => 'blocked: ' + error.message)`);
  check('안전: 점검 중 api.notion.com에 닿지 않음', String(reached).startsWith('blocked'), reached);
  await expect(check, page, '설정: 토큰 없으면 1단계가 지금 할 차례', `${STEPS} === 'active,todo,todo'`, STEPS);
  await expect(check, page, '설정: 토큰 없으면 시작 버튼 꺼짐', `document.getElementById('index-start').disabled`);
  await page.shot('options-first');
  await page.run(SEED_SAMPLE);
  await expect(check, page, '설정: 토큰·지도 있으면 3단계가 지금 할 차례', `${STEPS} === 'done,done,active'`, STEPS);
}

async function legendAndZoom(page: Page, check: Check): Promise<void> {
  await page.run(`document.getElementById('legend-db').click()`);
  const hidden = q(`$('legend-db').getAttribute('aria-pressed') + ',' + getComputedStyle($('legend-db')).textDecorationLine`);
  await expect(check, page, '범례: DB 항목을 누르면 숨김 표시(줄긋기)', `${hidden} === 'false,line-through'`, hidden);
  await page.run(`document.getElementById('legend-db').click()`);
  for (const id of ['legend-page', 'legend-db', 'legend-unreadable']) await page.run(`document.getElementById('${id}').click()`);
  await expect(check, page, '범례: 모두 숨기면 숨김을 푸는 안내', q(`!$('empty').hidden && $('empty-settings').hidden && $('empty-text').textContent.includes('숨겼어요')`));
  for (const id of ['legend-page', 'legend-db', 'legend-unreadable']) await page.run(`document.getElementById('${id}').click()`);
  const now = async (): Promise<number> => Number(await page.run(`document.querySelector('#graph canvas').getContext('2d').getTransform().a`));
  // 확대·맞춤 움직임이 끝나 배율이 멈춘 뒤의 값(처음 열 때의 전체 맞춤이 끝나기 전에 누르면 덮어써진다)
  const settled = async (): Promise<number> => {
    let previous = Number.NaN;
    for (let i = 0; i < 30; i += 1, await sleep(300)) {
      const current = await now();
      if (current === previous) return current;
      previous = current;
    }
    return previous;
  };
  await settled();
  // 버튼 움직임(0.25초)이 겹치면 한 번만 줄어들어서, 한 번씩 멈출 때까지 기다리며 최소 배율 근처까지 줄인다
  for (let i = 0; i < 12; i += 1) {
    await page.run(`document.getElementById('zoom-out').click()`);
    await settled();
  }
  const s1 = await settled();
  await page.run(`document.getElementById('zoom-out').click()`);
  const s2 = await settled();
  await page.run(`document.getElementById('zoom-in').click()`);
  const s3 = await settled();
  // 최소 배율 근처에서도 축소는 실제로 작아지고(아무 일도 안 하면 실패) 확대는 커져야 한다(반대로 움직이던 버그의 재발 방지)
  check('확대 버튼: 최소 배율 근처에서도 축소는 작게, 확대는 크게', s1 < 0.05 && s2 < s1 && s3 > s2, { s1, s2, s3 });
}

export async function graphBasics(browser: Browser, check: Check): Promise<void> {
  const page = await openGraph(browser);
  await page.shot('graph-light');
  await legendAndZoom(page, check);
  await pick(page, '로드');
  await expect(check, page, '검색→Enter: 선택하고 "Notion에서 열기"로 초점', `document.activeElement.id === 'sel-open'`, `document.activeElement.id`);
  await expect(check, page, '백링크: 받은·보낸 연결 수', panelIs('로드맵 / 받은 연결 2개 / 보낸 연결 3개'), PANEL);
  const lists = q(`[...$('sel-in').children].map((li) => li.textContent).join(',') + ' | ' + [...$('sel-out').children].map((li) => li.textContent).join(',')`);
  await expect(check, page, '백링크: 목록 내용', `${lists} === '온보딩 가이드,채용 계획 | 주간 회고,팀 위키,항목 20'`, lists);
  await page.run(`document.querySelector('#sel-in button').click()`);
  await expect(check, page, '백링크: 받은 연결을 누르면 그 페이지 선택', panelStarts('온보딩 가이드'), PANEL);
  await page.shot('backlinks');
  await listView(page, check);
}

async function listView(page: Page, check: Check): Promise<void> {
  await page.run(`document.getElementById('view-toggle').click()`);
  await page.run(`(() => { const s = document.getElementById('search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const first = q(`$('list-body').rows.length + ' | ' + [...$('list-body').rows[0].cells].slice(0, 4).map((c) => c.textContent).join('|')`);
  await expect(check, page, '목록 보기: 40행, 연결 많은 순', `${first} === '40 | 경쟁사 분석|페이지|5|2'`, first);
  await page.run(`document.querySelector('#list-body tr:nth-child(3) button').focus()`);
  const before = await page.run(`document.activeElement.getAttribute('aria-label')`);
  await page.run(`chrome.storage.local.set({ progress: { phase: 'done', read: 40, discovered: 41 } })`);
  await sleep(800);
  check('목록 보기: 색인 갱신으로 다시 그려도 초점 유지', (await page.run(`document.activeElement.getAttribute('aria-label')`)) === before);
  await page.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: false });
  await expect(check, page, '목록 보기: 360px 가로 넘침 없음', NO_HSCROLL);
  await page.run(`document.getElementById('view-toggle').click()`);
  await expect(check, page, '목록→그래프: 캔버스가 다시 화면 크기', `document.querySelector('#graph canvas').width === 360`, `document.querySelector('#graph canvas').width`);
}

/** 아이콘으로 연 지금 페이지는 한 번만 자동으로 고르고, 사용자가 고른 것은 덮어쓰지 않는다. */
export async function currentPage(browser: Browser, check: Check): Promise<void> {
  const page = await openGraph(browser);
  await page.run(`chrome.storage.session.set({ focusPageId: 'p2' })`);
  await expect(check, page, '지금 페이지: 바로 선택되고 초점은 옮기지 않음', `${panelIs('로드맵 / 받은 연결 2개 / 보낸 연결 3개')} && document.activeElement.tagName === 'BODY'`, PANEL);
  await pick(page, '항목 11');
  await waitFor(page, panelStarts('항목 11'));
  for (let i = 0; i < 2; i += 1) await page.run(`document.getElementById('legend-page').click()`);
  await sleep(500);
  await expect(check, page, '지금 페이지: 필터를 껐다 켜도 사용자 선택 유지', panelStarts('항목 11'), PANEL);
  await page.run(`document.getElementById('sel-clear').click()`);
  await expect(check, page, '선택 해제: 서랍 숨김·목록 비움', q(`$('selection').hidden && $('sel-in').children.length === 0`));
  await page.run(`document.getElementById('view-toggle').click()`);
  await page.run(`chrome.storage.session.set({ focusPageId: 'p5' })`);
  await expect(check, page, '지금 페이지: 목록 보기에서도 선택', panelStarts('데이터 모델'), PANEL);
}
