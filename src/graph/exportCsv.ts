import type { NodeRow } from './rows.ts';
import type { GraphData, PageRecord } from './types.ts';

// 엑셀이 수식으로 실행할 수 있는 시작 글자(전각 ＝＋－＠ 포함). 제목이 이걸로 시작하면 앞에 '를 붙여 글자로만 다루게 한다
// (CSV 수식 주입 막기). "- 아이디어"처럼 평범한 제목에도 '가 붙지만, 수식인지 가려내다 놓치는 것보다 안전을 택했다
const FORMULA_START = /^[=+\-@\t\r\n＝＋－＠]/;
// 엑셀이 한글을 깨뜨리지 않게 파일 맨 앞에 붙이는 표시(BOM). 눈에 안 보이는 문자라 이스케이프로 적는다
const BOM = '\uFEFF';

function cell(value: string | number): string {
  const text = typeof value === 'number' ? String(value) : FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** 표를 CSV 글로. 맨 앞에 BOM, 줄 끝은 CRLF(엑셀 기본). */
export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  return `${BOM}${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

const KIND_TEXT = (row: NodeRow): string => (row.unreadable ? '읽을 수 없음' : row.kind === 'dbItem' ? 'DB 항목' : '페이지');

export interface PageLookups {
  pages: ReadonlyMap<string, PageRecord>;
  databaseNames: Readonly<Record<string, string>>;
  urlOf: (id: string) => string;
}

/**
 * 페이지 목록: 화면의 목록 보기와 같은 줄(연결이 많은 순)에 소속 DB·주소·ID를 더한다. 제목이 같은 페이지는 ID로 구분한다.
 * 읽을 수 없는 페이지도 주소를 적는다(목록의 "열기"처럼, 연결을 추가하러 갈 수 있게).
 */
export function pagesCsv(rows: readonly NodeRow[], { pages, databaseNames, urlOf }: PageLookups): string {
  return toCsv([
    ['이름', '종류', '받은 연결', '보낸 연결', '소속 DB', '주소', 'ID'],
    ...rows.map((row) => {
      const database = pages.get(row.id)?.databaseId;
      return [row.title, KIND_TEXT(row), row.received, row.sent, database ? (databaseNames[database] ?? '') : '', urlOf(row.id), row.id];
    }),
  ]);
}

/**
 * 연결 목록: 한 줄이 "출발 페이지 → 도착 페이지". 관계가 "가리킴"이면 출발이 도착을 가리키고(양쪽으로 이어진 연결은 두 줄),
 * "상위→하위"(하위 페이지 선을 켰을 때)면 출발이 도착의 상위 페이지다. 제목이 같을 수 있어 ID도 적는다.
 */
export function linksCsv(data: GraphData): string {
  const title = new Map(data.nodes.map((node) => [node.id, node.title]));
  const row = (from: string, to: string, relation: string): string[] => [title.get(from) ?? '', title.get(to) ?? '', relation, from, to];
  const rows = data.links.flatMap((link) => {
    if (link.hierarchy) return [row(link.source, link.target, '상위→하위')];
    const forward = row(link.source, link.target, '가리킴');
    return link.bidirectional ? [forward, row(link.target, link.source, '가리킴')] : [forward];
  });
  return toCsv([['출발 페이지', '도착 페이지', '관계', '출발 ID', '도착 ID'], ...rows]);
}
