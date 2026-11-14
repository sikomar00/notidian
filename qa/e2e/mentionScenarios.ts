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

const GROUPS = q(`[...$('cleanup-list').querySelectorAll('h3')].map((h) => h.firstChild.textContent.trim()).join(' | ')`);
const VISIBLE = q(`['graph-area', 'list-view', 'cleanup-view'].filter((id) => !$(id).hidden).join(',')`);

/** 언급 정리(S2-8, F-23~F-27): 예시 모드에서 묶음·빼기·되돌리기, 저장된 지도에서 뺀 제목 기억. */
export async function mentionCleanup(browser: Browser, check: Check): Promise<void> {
  const demo = await browser.open(browser.ext('graph.html?mode=full&demo=1'));
  await waitFor(demo, `!!document.querySelector('#graph canvas')`);
  await demo.run(`document.getElementById('view-cleanup').click()`);
  await expect(check, demo, '정리: 버튼을 누르면 그래프 대신 언급 정리만 보임', `${VISIBLE} === 'cleanup-view' && document.getElementById('view-cleanup').getAttribute('aria-checked') === 'true'`, VISIBLE);
  await expect(check, demo, '정리: 글자가 적힌 페이지별 묶음, 많이 나온 순 → 제목 순', `${GROUPS} === '주간 회고 · 제목 1개 | 11월 2주 회의 · 제목 1개 | 메모 · 제목 1개 | 채용 계획 · 제목 1개'`, GROUPS);
  await demo.run(`document.querySelector('#cleanup-list button[aria-label="디자인 시스템 제목은 빼기"]').focus()`);
  await demo.press('Enter');
  await expect(check, demo, '정리: 제목을 빼면 그 제목만 있던 묶음이 사라짐(Enter)', `${GROUPS} === '메모 · 제목 1개 | 채용 계획 · 제목 1개'`, GROUPS);
  await expect(check, demo, '정리: 뺀 버튼이 사라지면 초점은 안내 문구로', `document.activeElement.id === 'cleanup-note'`, `document.activeElement.id`);
  await expect(check, demo, '정리: 뺀 제목 수와 되돌리기', `document.querySelector('#cleanup-ignored summary')?.textContent === '뺀 제목 1개 · 되돌리기'`);
  await expect(check, demo, '정리: 예시 모드는 뺀 제목을 저장하지 않음', `chrome.storage.local.get('ignoredMentionTitles').then((s) => s.ignoredMentionTitles === undefined)`);
  await demo.shot('cleanup');
  await demo.run(`document.getElementById('view-graph').click()`);
  await pick(demo, '디자인 시');
  await expect(check, demo, '정리: 뺀 제목은 서랍 칸에서도 빠짐', `${NOTE} === '언급 정리에서 뺀 제목이라 찾지 않아요'`, NOTE);
  await demo.run(`document.getElementById('view-cleanup').click()`);
  await waitFor(demo, `!!document.querySelector('#cleanup-ignored summary')`);
  await demo.run(`(() => { document.querySelector('#cleanup-ignored details').open = true; document.querySelector('#cleanup-ignored button').click(); })()`);
  await expect(check, demo, '정리: 다시 넣으면 묶음이 돌아옴', `document.querySelectorAll('#cleanup-list h3').length === 4 && document.getElementById('cleanup-ignored').children.length === 0`, GROUPS);
  // 연결 없는 "메모"도 정리 대상이다. 외톨이 숨기기를 켜도 목록에서 빠지지 않는다(F-26)
  await demo.run(`document.getElementById('isolated').click()`);
  await expect(check, demo, '정리: 외톨이 숨기기를 켜도 연결 없는 페이지의 언급은 남음', `${GROUPS}.includes('메모 · 제목 1개')`, GROUPS);
  await demo.run(`document.getElementById('isolated').click()`);
  // 보기 전환은 라디오 묶음: 방향키로 옮기며 고르고, 언급 정리를 보는 동안 그림 저장은 안내만 한다
  await demo.run(`document.getElementById('view-cleanup').click()`);
  await demo.run(`document.getElementById('export-png').click()`);
  await expect(check, demo, '정리: 언급 정리를 보는 동안 그림 저장은 안내만', `document.getElementById('notice').textContent.includes('"그래프" 보기')`, `document.getElementById('notice').textContent`);
  await demo.run(`document.getElementById('view-cleanup').focus()`);
  await demo.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  await expect(check, demo, '보기 전환: 방향키(←)로 목록을 고르고 초점도 옮김', `${VISIBLE} === 'list-view' && document.activeElement.id === 'view-list' && document.getElementById('view-list').tabIndex === 0 && document.getElementById('view-cleanup').tabIndex === -1`, VISIBLE);
  await demo.run(`document.getElementById('view-list').click()`);
  await expect(check, demo, '정리: 목록 보기로 바꾸면 하나만 보임', `${VISIBLE} === 'list-view' && document.getElementById('view-cleanup').getAttribute('aria-checked') === 'false'`, VISIBLE);
  demo.close();

  // 저장된 지도: 본문 글자 하나를 넣고 제목을 빼면 저장되고, 다시 열어도 빠져 있다
  const seeded = await openGraph(browser);
  await seeded.run(`(async () => {
    const db = await new Promise((done) => { const r = indexedDB.open('notidian'); r.onsuccess = () => done(r.result); });
    await new Promise((done) => { const tx = db.transaction('texts', 'readwrite'); tx.objectStore('texts').put({ id: 'p19', text: '예산안과 채용 계획, 브랜드 가이드를 함께 본다' }); tx.oncomplete = done; });
    db.close();
  })()`);
  await seeded.run(`location.reload()`);
  await waitFor(seeded, `!!document.querySelector('#graph canvas')`);
  await seeded.run(`document.getElementById('view-cleanup').click()`);
  await waitFor(seeded, `!!document.querySelector('#cleanup-list button[aria-label$="제목은 빼기"]')`);
  const removed = String(await seeded.run(`(() => { const b = document.querySelector('#cleanup-list button[aria-label$="제목은 빼기"]'); b.click(); return b.getAttribute('aria-label').replace(' 제목은 빼기', ''); })()`));
  await expect(check, seeded, '정리: 뺀 제목을 이 브라우저에 저장', `chrome.storage.local.get('ignoredMentionTitles').then((s) => JSON.stringify(s.ignoredMentionTitles) === ${JSON.stringify(JSON.stringify([removed]))})`, removed);
  await seeded.run(`location.reload()`);
  await waitFor(seeded, `!!document.querySelector('#graph canvas')`);
  await seeded.run(`document.getElementById('view-cleanup').click()`);
  await expect(check, seeded, '정리: 다시 열어도 뺀 제목은 빠져 있음', `document.querySelector('#cleanup-ignored summary')?.textContent === '뺀 제목 1개 · 되돌리기' && !document.getElementById('cleanup-list').textContent.includes(${JSON.stringify(removed)} + ' · ')`, removed);
}
