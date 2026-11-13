// 점검용 가짜 색인. 확장 페이지 안에서 실행해 IndexedDB와 저장소에 넣는다. 토큰은 자리만 채운 가짜 값이다.
const PUT_ALL = `
  const db = await new Promise((done, fail) => { const r = indexedDB.open('notidian'); r.onsuccess = () => done(r.result); r.onerror = () => fail(r.error); });
  await new Promise((done, fail) => { const tx = db.transaction(['pages', 'links'], 'readwrite'); for (const p of pages) tx.objectStore('pages').put(p); for (const l of links) tx.objectStore('links').put(l); tx.oncomplete = done; tx.onerror = () => fail(tx.error); });`;

const page = `(id, title, kind, status) => ({ id, title, kind, url: '', lastEdited: '2026-11-13T00:00:00.000Z', status, ...(status === 'unreadable' ? { unreadableReason: 'forbidden' } : {}), readAt: '2026-11-13T01:00:00.000Z', failCount: 0 })`;

/** 40페이지(p0~p39): p28 이후는 DB 항목, p37 이후는 읽을 수 없음. 같은 씨앗이라 늘 같은 연결이 나온다. */
export const SEED_SAMPLE = `(async () => {
  const page = ${page};
  const names = ['프로젝트 기획','회의록 11월','로드맵','디자인 시스템','API 명세','데이터 모델','릴리스 노트','고객 인터뷰','경쟁사 분석','OKR 2026','주간 회고','버그 리포트','온보딩 가이드','팀 위키','채용 계획','예산안','마케팅 캠페인','브랜드 가이드','지표 대시보드','실험 기록'];
  const pages = []; const links = []; let seed = 7;
  const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let i = 0; i < 40; i += 1) pages.push(page('p' + i, i < 20 ? names[i] : '항목 ' + (i - 19), i >= 28 ? 'dbItem' : 'page', i >= 37 ? 'unreadable' : 'ok'));
  for (let i = 0; i < 70; i += 1) { const a = Math.floor(rand() * 40); const b = a < 14 ? Math.floor(rand() * 14) : Math.floor(rand() * 40); if (a !== b) links.push({ from: 'p' + a, to: 'p' + b }); }
  links.push({ from: 'p1', to: 'p38' }, { from: 'p2', to: 'p39' });
  ${PUT_ALL}
  await chrome.storage.local.set({ token: 'e2e-fake-token', tokenKind: 'internal', progress: { phase: 'done', read: 40, discovered: 40 } });
})()`;

/** 따라가기 점검용: Notion 주소로 쓸 수 있는 ID의 3페이지. Alpha→Beta, Gamma→Alpha */
export const HEX = { A: '11111111111111111111111111111111', B: '22222222222222222222222222222222', C: '33333333333333333333333333333333', D: '44444444444444444444444444444444' };
export const uuid = (hex: string): string => hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
export const SEED_FOLLOW = `(async () => {
  const page = ${page};
  const pages = [page('${uuid(HEX.A)}', 'Alpha', 'page', 'ok'), page('${uuid(HEX.B)}', 'Beta', 'page', 'ok'), page('${uuid(HEX.C)}', 'Gamma', 'page', 'ok')];
  const links = [{ from: '${uuid(HEX.A)}', to: '${uuid(HEX.B)}' }, { from: '${uuid(HEX.C)}', to: '${uuid(HEX.A)}' }];
  ${PUT_ALL}
})()`;

/** id로 요소를 찾는 \`$\`를 쓸 수 있게 감싼다. */
export const q = (expression: string): string => `(() => { const $ = (id) => document.getElementById(id); return ${expression}; })()`;
export const PANEL = q(`$('selection').hidden ? null : $('sel-title').textContent + ' / ' + $('in-title').textContent + ' / ' + $('out-title').textContent`);
export const NO_HSCROLL = 'document.documentElement.scrollWidth <= document.documentElement.clientWidth';

/** 장면 사이에 남은 상태(지금 페이지·진행 상황)를 처음처럼 되돌린다. 장면이 중간에 실패해도 다음 장면이 영향을 받지 않게 한다. */
export const RESET = `chrome.storage.session.set({ focusPageId: null }).then(() => chrome.storage.local.set({ progress: { phase: 'done', read: 40, discovered: 40 } }))`;
