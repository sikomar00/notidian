export interface Palette {
  background: string;
  text: string;
  page: string;
  dbItem: string;
  /** DB별 색: 처음 알게 된 두 DB의 색. 첫 칸은 dbItem과 같다 */
  databases: readonly [string, string];
  /** 셋째 DB부터 묶는 "기타 DB" 색. "읽을 수 없음"(회색 점선 테두리)과 모양도 밝기도 다르게 한다 */
  otherDatabase: string;
  unreadable: string;
  link: string;
  /** 점이 많아 선을 가늘게 그릴 때의 선 색. 가는 선은 테두리가 흐려져서 더 진하게(어두운 테마는 더 밝게) 한다 */
  thinLink: string;
  linkActive: string;
  focus: string;
}

// 글자는 배경과 4.5:1, 점·선은 3:1 이상(WCAG 2.1 AA, NF-3). 값은 tests/palette.test.ts가 계산으로 검사한다.
// 페이지·DB 항목 색은 dataviz 검증기(밝기 범위·색각 이상 구분·대비)를 통과한 값이다. DB별 색은 그래프가 흩어진 점이라
// "모든 쌍" 기준으로 검사했고, 페이지 파랑과 함께 3:1 대비를 지키며 통과하는 것이 두 색까지라 셋째 DB부터는 "기타 DB"로 묶는다. "읽을 수 없음"은 색 구분이 아니라
// 상태 표시라서 회색 + 점선 테두리로 그린다(색만으로 구분하지 않기)
const LIGHT_DB = '#c2410c';
const DARK_DB = '#d5702a';

// 바탕·글자는 화면 공통 디자인(src/extension/ui.css)과 같은 값이다
export const LIGHT: Palette = {
  background: '#ffffff',
  text: '#37352f',
  page: '#2563eb',
  dbItem: LIGHT_DB,
  databases: [LIGHT_DB, '#0e7c56'],
  otherDatabase: '#374151',
  unreadable: '#6b7280',
  link: '#8a8a8a',
  thinLink: '#3b4150',
  linkActive: '#000000',
  focus: '#c01c28',
};

export const DARK: Palette = {
  background: '#191919',
  text: '#e6e6e3',
  page: '#4f8ff0',
  dbItem: DARK_DB,
  databases: [DARK_DB, '#22a878'],
  otherDatabase: '#d1d5db',
  unreadable: '#a0a7b4',
  link: '#8a8a8a',
  thinLink: '#c4c9d4',
  linkActive: '#ffffff',
  focus: '#ffd54a',
};

/**
 * DB마다 쓸 색. 처음 알게 된 순서(`order`)로 앞의 두 DB에 색을 주고 나머지는 "기타 DB" 색이다.
 * 새 DB가 생겨도 이미 색이 있는 DB의 색은 바뀌지 않는다(연결 수 같은 순위로 정하지 않는다).
 */
export function databaseColors(order: readonly string[], palette: Palette): Map<string, string> {
  return new Map(order.map((id, index) => [id, palette.databases[index] ?? palette.otherDatabase]));
}

export function currentPalette(): Palette {
  return matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT;
}

/** 범례 견본 색을 그래프 점과 같은 팔레트에서 가져온다. 바탕·글자색은 ui.css가 테마에 맞춰 바꾼다. */
export function applyPaletteVars(palette: Palette): void {
  const style = document.documentElement.style;
  style.setProperty('--page', palette.page);
  style.setProperty('--db', palette.dbItem);
  style.setProperty('--unreadable', palette.unreadable);
}
