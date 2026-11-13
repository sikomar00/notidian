// 좁은 화면·로컬 그래프·옆 패널 따라가기 점검
import { contrastRatio } from '../../src/graph/contrast.ts';
import { HEX, NO_HSCROLL, PANEL, SEED_FOLLOW } from './fixtures.ts';
import { openGraph, pick } from './graphScenarios.ts';
import { expect, sleep, waitFor } from './harness.ts';
import type { Browser, Check } from './harness.ts';

const panelStarts = (title: string): string => `String(${PANEL}).startsWith(${JSON.stringify(`${title} /`)})`;

// 도구줄 버튼·입력칸이 화면에 보이는 순서(위→아래, 왼→오)와 키보드 순서(문서 순서)가 같은지.
// 같은 줄이라도 높이가 다른 요소(선택 상자 등)는 윗변이 달라서 세로 가운데로 줄을 판단한다
const TAB_ORDER_MATCHES = `(() => {
  // 닫힌 접이식 묶음(details) 안의 요소는 위치는 있어도 보이지 않고 키보드로도 가지 않아서 뺀다
  const reachable = (e) => e.offsetParent !== null && (!e.closest('details:not([open])') || e.tagName === 'SUMMARY');
  const pos = [...document.querySelectorAll('header button, header input, header select, header summary')].filter(reachable).map((e) => { const r = e.getBoundingClientRect(); return { mid: r.top + r.height / 2, left: r.left }; });
  return pos.every((p, i) => i === 0 || p.mid > pos[i - 1].mid + 8 || (Math.abs(p.mid - pos[i - 1].mid) <= 8 && p.left > pos[i - 1].left));
})()`;

/** 계산된 색(rgb(...) 또는 color(srgb 0~1 ...))을 #rrggbb로 바꿔 기존 대비 계산을 그대로 쓴다. */
function toHex(color: string): string {
  const scale = color.startsWith('color(srgb') ? 255 : 1;
  const channels = (color.match(/[0-9.]+/g) ?? []).slice(0, 3).map((v) => Math.round(Number(v) * scale));
  return `#${channels.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export async function narrowLayout(browser: Browser, check: Check): Promise<void> {
  for (const scheme of ['light', 'dark'] as const) {
    const page = await browser.open(browser.ext('graph.html?mode=side'), { width: 360, height: 800, scheme });
    await waitFor(page, `!!document.querySelector('#graph canvas')`);
    const header = `Math.round(document.querySelector('header').getBoundingClientRect().height)`;
    await expect(check, page, `360px(${scheme}): 도구줄 200px 이하, 가로 넘침 없음`, `${header} <= 200 && ${NO_HSCROLL}`, header);
    await expect(check, page, `360px(${scheme}): 키보드 순서 = 화면 순서`, TAB_ORDER_MATCHES);
    const colors = (await page.run(`[getComputedStyle(document.getElementById('search'), '::placeholder').color, getComputedStyle(document.body).backgroundColor]`)) as [string, string];
    const ratio = contrastRatio(toHex(colors[0]), toHex(colors[1]));
    check(`360px(${scheme}): 검색 안내 문구 대비 4.5:1 이상`, ratio >= 4.5, ratio.toFixed(2));
    await page.shot(`narrow-${scheme}`);
  }
}

export async function localGraph(browser: Browser, check: Check): Promise<void> {
  const page = await openGraph(browser);
  await expect(check, page, '주변만: 꺼져 있으면 단계 선택 꺼짐', `document.getElementById('local-depth').disabled`);
  await page.run(`document.getElementById('local').click()`);
  await expect(check, page, '주변만: 선택 없이 켜면 안내', `!document.getElementById('local-hint').hidden`);
  await pick(page, '로드');
  await expect(check, page, '주변만: 켜도 받은·보낸 연결은 전체 기준', `${PANEL} === '로드맵 / 받은 연결 2개 / 보낸 연결 3개'`, PANEL);
  await sleep(1500);
  await page.shot('local-2');
  await page.run(`document.querySelector('#sel-in button').click()`);
  await expect(check, page, '주변만: 연결 목록에서 고르면 새 중심', panelStarts('온보딩 가이드'), PANEL);
  await pick(page, '예산');
  await expect(check, page, '주변만: 검색으로 주변 밖 페이지도 고름', panelStarts('예산안'), PANEL);
  await page.run(`document.getElementById('sel-clear').click()`);
  await expect(check, page, '주변만: 선택을 풀면 다시 안내', `!document.getElementById('local-hint').hidden`);
}

/** 옆 패널은 같은 창의 Notion 탭만 따라간다. Notion 주소는 가로채서 가짜 페이지로 답한다. */
export async function sidePanelFollow(browser: Browser, check: Check): Promise<void> {
  const seed = await browser.open(browser.ext('options.html'));
  await waitFor(seed, `document.readyState === 'complete'`);
  await seed.run(SEED_FOLLOW);
  const side = await openGraph(browser, 'side');
  const full = await openGraph(browser, 'full');
  const notion = await browser.open(`https://app.notion.com/p/Alpha-${HEX.A}`);
  await expect(check, side, '따라가기: 옆 패널이 Alpha 선택', `${PANEL} === 'Alpha / 받은 연결 1개 / 보낸 연결 1개'`, PANEL);
  check('따라가기: 전체 화면 그래프는 그대로', (await full.run(PANEL)) === null, await full.run(PANEL));
  const origin = await seed.run(`chrome.storage.session.get('originTabId').then((s) => s.originTabId)`);
  const tabId = await seed.run(`chrome.tabs.query({ url: 'https://app.notion.com/*' }).then((tabs) => tabs[0]?.id)`);
  check('따라가기: 가운데 창용 탭 번호 갱신', origin === tabId, { origin, tabId });
  await notion.run(`history.pushState({}, '', '/p/Beta-${HEX.B}')`);
  await expect(check, side, '따라가기: 주소만 바뀌는 이동(pushState)', panelStarts('Beta'), PANEL);
  await notion.send('Page.navigate', { url: `https://app.notion.com/p/New-${HEX.D}` });
  await expect(check, side, '따라가기: 색인에 없는 페이지면 선택 풀림', `${PANEL} === null`, PANEL);
  await notion.send('Page.navigate', { url: `https://app.notion.com/p/Gamma-${HEX.C}` });
  await waitFor(side, panelStarts('Gamma'));
  await browser.openInNewWindow(`https://app.notion.com/p/Alpha-${HEX.A}`);
  await sleep(1500);
  check('따라가기: 다른 창의 Notion 탭은 무시', (await side.run(panelStarts('Gamma'))) === true, await side.run(PANEL));
}
