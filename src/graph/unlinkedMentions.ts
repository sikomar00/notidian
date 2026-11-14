/** 연결 안 된 언급 한 건: 제목이 글자로 나온 페이지, 나온 횟수, 처음 나온 곳의 앞뒤 글자. */
export interface Mention {
  id: string;
  title: string;
  count: number;
  before: string;
  match: string;
  after: string;
}

/** 찾기 전에 한 번만 준비해 둔 본문: 원문 줄(앞뒤 글자용)과 비교용 줄(NFC·소문자). 페이지를 고를 때마다 다시 만들지 않는다. */
export interface PreparedText {
  id: string;
  title: string;
  lines: string[];
  folded: string[];
}

const MIN_TITLE = 3;
const CONTEXT = 30;
const EMPTY_TITLES = new Set(['', '제목 없음', '(제목 없음)', 'untitled']);
const LATIN_OR_DIGIT = /[\p{Script=Latin}\p{N}]/u;

// shortcut: 소문자로 바꿔 길이가 달라지는 문자(터키어 İ 등)가 있으면 앞뒤 글자 위치가 어긋난다. 그런 제목이 실제로 나오면 위치를 원문 기준으로 다시 찾는다
const fold = (text: string): string => text.normalize('NFC').toLowerCase();

/** 비교용 제목(NFC·소문자). 너무 짧거나(2글자 이하) 제목이 없으면 null — 찾지 않는다. */
export function normalizeTitle(title: string): string | null {
  const folded = fold(title.trim());
  return EMPTY_TITLES.has(folded) || [...folded].length < MIN_TITLE ? null : folded;
}

// 제목 끝이 라틴 문자·숫자이면 바로 바깥도 그렇지 않아야 한다("art"는 "start"에서 안 찾음). 한글 쪽은 조사가 붙으니 보지 않는다
export function atBoundary(line: string, start: number, title: string): boolean {
  const end = start + title.length;
  const edge = (inside: string | undefined, outside: string | undefined): boolean =>
    !(inside && outside && LATIN_OR_DIGIT.test(inside) && LATIN_OR_DIGIT.test(outside));
  return edge(title[0], line[start - 1]) && edge(title.at(-1), line[end]);
}

function positions(line: string, title: string): number[] {
  const found: number[] = [];
  for (let at = line.indexOf(title); at !== -1; at = line.indexOf(title, at + title.length)) {
    if (atBoundary(line, at, title)) found.push(at);
  }
  return found;
}

export type Context = Pick<Mention, 'before' | 'match' | 'after'>;

/** 원문 줄에서 찾은 곳과 앞뒤 30자(잘렸으면 "…"). */
export function contextAt(line: string, at: number, length: number): Context {
  const end = at + length;
  // 30자로 자를 때 이모지 같은 두 칸짜리 글자가 반으로 갈리면 그 반쪽을 버린다
  const before = line.slice(Math.max(0, at - CONTEXT), at).replace(/^[\uDC00-\uDFFF]/, '');
  const after = line.slice(end, end + CONTEXT).replace(/[\uD800-\uDBFF]$/, '');
  return {
    before: (at > CONTEXT ? '…' : '') + before,
    match: line.slice(at, end),
    after: after + (line.length - end > CONTEXT ? '…' : ''),
  };
}

// 블록(줄) 하나 안에서만 찾는다
function scan(page: PreparedText, title: string): (Context & { count: number }) | undefined {
  let count = 0;
  let first: Context | undefined;
  page.folded.forEach((line, index) => {
    const hits = positions(line, title);
    count += hits.length;
    if (!first && hits[0] !== undefined) first = contextAt(page.lines[index] ?? '', hits[0], title.length);
  });
  return first ? { count, ...first } : undefined;
}

/** 저장된 본문을 찾기용으로 준비한다. 제목을 모르는 페이지(지도에 없는 페이지의 남은 글자)는 뺀다. */
export function prepareTexts(texts: readonly { id: string; text: string }[], titleOf: (id: string) => string | undefined): PreparedText[] {
  return texts.flatMap(({ id, text }) => {
    const title = titleOf(id);
    if (title === undefined) return [];
    const lines = text.normalize('NFC').split('\n');
    return [{ id, title, lines, folded: lines.map((line) => line.toLowerCase()) }];
  });
}

/**
 * 고른 페이지(`target`)의 제목이 연결 없이 글자로만 적힌 다른 페이지들(F-18·F-19). 나온 횟수 많은 순, 같으면 제목 순.
 * 제목이 너무 짧거나 없으면 `'too-short'`. `linkedFrom`은 이미 target으로 연결이 있는 페이지다.
 */
export function findUnlinkedMentions(
  target: { id: string; title: string },
  pages: readonly PreparedText[],
  linkedFrom: ReadonlySet<string>,
): Mention[] | 'too-short' {
  const title = normalizeTitle(target.title);
  if (title === null) return 'too-short';
  const found: Mention[] = [];
  for (const page of pages) {
    if (page.id === target.id || linkedFrom.has(page.id)) continue;
    const hit = scan(page, title);
    if (hit) found.push({ id: page.id, title: page.title, ...hit });
  }
  // 받은·보낸 연결 목록과 같은 한국어 정렬
  return found.sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ko'));
}
