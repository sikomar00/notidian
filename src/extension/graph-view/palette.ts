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

// 글자는 배경과 4.5:1, 점·선은 3:1 이상(WCAG 2.1 AA, NF-3). 값은 tests/palette.test.ts가 계산으로 검사한다
export const LIGHT: Palette = {
  background: '#ffffff',
  text: '#1a1a1a',
  page: '#1a5fb4',
  dbItem: '#a34100',
  unreadable: '#6b6b6b',
  link: '#8a8a8a',
  linkActive: '#000000',
  focus: '#c01c28',
};

export const DARK: Palette = {
  background: '#1b1b1b',
  text: '#f0f0f0',
  page: '#7ab7ff',
  dbItem: '#ffb066',
  unreadable: '#a8a8a8',
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
}
