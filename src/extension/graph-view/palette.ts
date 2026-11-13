export interface Palette {
  background: string;
  text: string;
  page: string;
  dbItem: string;
  unreadable: string;
  link: string;
  linkActive: string;
  focus: string;
}

// 글자는 배경과 4.5:1, 점·선은 3:1 이상(WCAG 2.1 AA, NF-3). 값은 tests/palette.test.ts가 계산으로 검사한다.
// 페이지·DB 항목 색은 dataviz 검증기(밝기 범위·색각 이상 구분·대비)를 통과한 값이다. "읽을 수 없음"은 색 구분이 아니라
// 상태 표시라서 회색 + 점선 테두리로 그린다(색만으로 구분하지 않기)
export const LIGHT: Palette = {
  background: '#ffffff',
  text: '#1d2330',
  page: '#2563eb',
  dbItem: '#c2410c',
  unreadable: '#6b7280',
  link: '#8a8a8a',
  linkActive: '#000000',
  focus: '#c01c28',
};

export const DARK: Palette = {
  background: '#16181d',
  text: '#e9ecf2',
  page: '#4f8ff0',
  dbItem: '#d5702a',
  unreadable: '#a0a7b4',
  link: '#8a8a8a',
  linkActive: '#ffffff',
  focus: '#ffd54a',
};

export function currentPalette(): Palette {
  return matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
}

/** 화면 바탕·글자색을 그래프와 같은 팔레트에서 가져온다. */
export function applyPaletteVars(palette: Palette): void {
  const style = document.documentElement.style;
  style.setProperty('--bg', palette.background);
  style.setProperty('--text', palette.text);
  style.setProperty('--focus', palette.focus);
  style.setProperty('--page', palette.page);
  style.setProperty('--db', palette.dbItem);
  style.setProperty('--unreadable', palette.unreadable);
}
