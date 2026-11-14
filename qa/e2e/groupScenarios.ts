// 그래프 색 그룹(F-35~F-37) 점검: 예시 데이터에서 그룹을 만들고, 범례·점 색·패널 글자·지우기를 본다
import { NO_HSCROLL, q } from './fixtures.ts';
import { expect, sleep, waitFor } from './harness.ts';
import type { Browser, Check } from './harness.ts';
import { pick } from './graphScenarios.ts';

const LEGEND = q(`$('group-legend').hidden ? '' : $('group-legend').textContent`);
// 그래프 캔버스에서 그 색 픽셀 수
const pixelsOf = (hex: string): string => `(() => {
  const c = document.querySelector('#graph canvas');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt('${hex}'.slice(i, i + 2), 16));
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] === r && d[i + 1] === g && d[i + 2] === b) n += 1;
  return n;
})()`;
const PURPLE = '#7c3aed';

export async function colorGroups(browser: Browser, check: Check): Promise<void> {
  const page = await browser.open(browser.ext('graph.html?mode=full&demo=1'));
  await waitFor(page, `!!document.querySelector('#graph canvas')`);
  await page.run(`document.querySelector('details.options').open = true`);
  await page.run(`document.getElementById('group-add').click()`);
  await page.run(`(() => { const i = document.querySelector('#group-editor input'); i.value = '회의'; i.dispatchEvent(new Event('change')); })()`);
  await expect(check, page, '색 그룹: 제목 글자 그룹의 범례와 개수', `${LEGEND} === '"회의" 포함 2개'`, LEGEND);
  await sleep(600);
  check('색 그룹: 그 점들이 그룹 색(보라)으로 칠해짐', Number(await page.run(pixelsOf(PURPLE))) > 50, await page.run(pixelsOf(PURPLE)));
  await page.shot('color-groups');
  await page.run(`document.querySelector('details.options').open = false`);
  await pick(page, '11월 1주');
  await expect(check, page, '색 그룹: 고른 페이지 패널에 그룹을 글자로', `document.getElementById('sel-meta').textContent.startsWith('그룹: "회의" 포함 · 마지막 수정: ')`, `document.getElementById('sel-meta').textContent`);
  await page.run(`document.querySelector('details.options').open = true`);
  await page.run(`(() => { const s = document.querySelector('#group-editor select[aria-label="그룹 1 조건"]'); s.value = 'parent'; s.dispatchEvent(new Event('change')); })()`);
  await page.run(`(() => { const s = document.querySelector('#group-editor select[aria-label="그룹 1 상위 페이지 아래"]'); s.value = [...s.options].find((o) => o.text === '팀 위키').value; s.dispatchEvent(new Event('change')); })()`);
  await expect(check, page, '색 그룹: 상위 페이지 아래 전부(하위의 하위까지)', `${LEGEND} === '팀 위키 아래 5개'`, LEGEND);
  await expect(check, page, '색 그룹: 예시 모드는 저장하지 않음', `chrome.storage.local.get('colorGroups').then((s) => s.colorGroups === undefined)`);
  await page.run(`document.querySelector('#group-editor button[aria-label="그룹 1 지우기"]').click()`);
  await sleep(600);
  await expect(check, page, '색 그룹: 지우면 범례·색이 사라짐', `${LEGEND} === '' && ${pixelsOf(PURPLE)} === 0`, LEGEND);
  page.close();

  const narrow = await browser.open(browser.ext('graph.html?mode=side&demo=1'), { width: 360, height: 800 });
  await waitFor(narrow, `!!document.querySelector('#graph canvas')`);
  await narrow.run(`(() => { document.querySelector('details.options').open = true; document.getElementById('group-add').click(); })()`);
  await expect(check, narrow, '색 그룹: 360px에서 편집 칸이 화면 안(가로 넘침 없음)', `${NO_HSCROLL} && document.querySelector('.options-panel').getBoundingClientRect().right <= 360`, `document.querySelector('.options-panel').getBoundingClientRect().right`);
  await narrow.shot('color-groups-360');
}

/** 다시 볼 페이지(F-38·F-39): 외톨이를 고르고 "다른 페이지"를 두 번 누르면 서로 다른 외톨이를 그래프에서 고른다. */
export async function resurface(browser: Browser, check: Check): Promise<void> {
  const page = await browser.open(browser.ext('graph.html?mode=full&demo=1'));
  await waitFor(page, `!!document.querySelector('#graph canvas')`);
  await page.run(`(() => { const s = document.getElementById('resurface-mode'); s.value = 'lonely'; s.dispatchEvent(new Event('change')); })()`);
  const counts = q(`$('selection').hidden ? null : [$('sel-title').textContent, $('in-title').textContent, $('out-title').textContent].join(' / ')`);
  await page.run(`document.getElementById('resurface').click()`);
  await expect(check, page, '다시 볼 페이지: 외톨이(연결 1개 이하)를 골라 패널을 엶', `(() => { const t = ${counts}; if (!t) return false; const n = [...t.matchAll(/(\d+)개/g)].reduce((s, m) => s + Number(m[1]), 0); return n <= 1; })()`, counts);
  const first = await page.run(`document.getElementById('sel-title').textContent`);
  await page.run(`document.getElementById('resurface').click()`);
  await expect(check, page, '다시 볼 페이지: 다시 누르면 다른 페이지', `document.getElementById('sel-title').textContent !== ${JSON.stringify(first)}`, `document.getElementById('sel-title').textContent`);
  await expect(check, page, '다시 볼 페이지: 초점은 버튼에 남고, 패널에 마지막 수정', `document.activeElement.id === 'resurface' && document.getElementById('sel-meta').textContent.includes('마지막 수정: ')`, `document.getElementById('sel-meta').textContent`);
  await page.shot('resurface');
}
