import { atBoundary, contextAt, normalizeTitle } from './unlinkedMentions.ts';
import type { Mention, PreparedText } from './unlinkedMentions.ts';

/** 언급 정리 한 묶음: 글자가 적힌 페이지와, 거기서 찾은 다른 페이지 제목들(F-23). */
export interface MentionGroup {
  sourceId: string;
  title: string;
  mentions: Mention[];
}

interface Pattern {
  title: string;
  targets: { id: string; title: string }[];
}

interface Node {
  next: Map<string, number>;
  fail: number;
  /** 이 상태에서 끝나는 제목(패턴 번호). 실패 링크를 따라 짧은 제목까지 모아 둔다 */
  out: number[];
}

/** 모든 제목을 본문에서 한 번에 찾는 Aho-Corasick 자동자. 제목마다 전체 글자를 훑으면 2,000페이지에서 너무 느리다. */
export interface Matcher {
  nodes: Node[];
  patterns: Pattern[];
}

function insert(nodes: Node[], title: string): number {
  let state = 0;
  // 본문을 UTF-16 단위로 훑으므로 제목도 같은 단위로 넣는다(이모지 등 두 칸짜리 글자에서 어긋나지 않게)
  for (let i = 0; i < title.length; i += 1) {
    const char = title[i] as string;
    let next = nodes[state]?.next.get(char);
    if (next === undefined) {
      next = nodes.push({ next: new Map(), fail: 0, out: [] }) - 1;
      nodes[state]?.next.set(char, next);
    }
    state = next;
  }
  return state;
}

// 너비 우선으로 실패 링크를 잇는다(표준 Aho-Corasick 구성)
function link(nodes: Node[]): void {
  const queue = [...(nodes[0]?.next.values() ?? [])];
  for (let index = 0; index < queue.length; index += 1) {
    const state = queue[index] as number;
    const node = nodes[state] as Node;
    for (const [char, child] of node.next) {
      let fail = node.fail;
      while (fail !== 0 && !nodes[fail]?.next.has(char)) fail = nodes[fail]?.fail ?? 0;
      const target = nodes[fail]?.next.get(char);
      const childNode = nodes[child] as Node;
      childNode.fail = target !== undefined && target !== child ? target : 0;
      childNode.out.push(...(nodes[childNode.fail]?.out ?? []));
      queue.push(child);
    }
  }
}

/**
 * 찾을 제목들로 자동자를 만든다. 짧거나 없는 제목, 뺀 제목(`ignored`, 비교용 제목)은 넣지 않는다.
 * 같은 제목의 페이지가 여럿이면 한 패턴에 모두 묶인다(서랍 칸에서도 둘 다의 언급으로 잡힌다).
 */
export function buildMatcher(targets: readonly { id: string; title: string }[], ignored: ReadonlySet<string> = new Set()): Matcher {
  const byTitle = new Map<string, Pattern>();
  for (const target of targets) {
    const title = normalizeTitle(target.title);
    if (title === null || ignored.has(title)) continue;
    const pattern = byTitle.get(title) ?? { title, targets: [] };
    pattern.targets.push(target);
    byTitle.set(title, pattern);
  }
  const nodes: Node[] = [{ next: new Map(), fail: 0, out: [] }];
  const patterns = [...byTitle.values()];
  patterns.forEach((pattern, index) => nodes[insert(nodes, pattern.title)]?.out.push(index));
  link(nodes);
  return { nodes, patterns };
}

type Hits = Map<string, Mention>;

// 줄 하나를 훑어 제목이 나온 곳을 센다. 같은 제목은 서랍 칸(indexOf로 겹치지 않게 찾기)과 같게 앞 출현이 끝난 뒤부터만 센다
function scanLine(matcher: Matcher, line: string, add: (pattern: Pattern, at: number) => void): void {
  const nextAllowed = new Map<number, number>();
  let state = 0;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] as string;
    while (state !== 0 && !matcher.nodes[state]?.next.has(char)) state = matcher.nodes[state]?.fail ?? 0;
    state = matcher.nodes[state]?.next.get(char) ?? 0;
    for (const index of matcher.nodes[state]?.out ?? []) {
      const pattern = matcher.patterns[index] as Pattern;
      const start = i + 1 - pattern.title.length;
      if (start < (nextAllowed.get(index) ?? 0)) continue;
      nextAllowed.set(index, start + pattern.title.length);
      if (atBoundary(line, start, pattern.title)) add(pattern, start);
    }
  }
}

function hitsIn(matcher: Matcher, page: PreparedText, linked: ReadonlySet<string>): Hits {
  const hits: Hits = new Map();
  page.folded.forEach((line, lineIndex) => {
    scanLine(matcher, line, (pattern, at) => {
      for (const target of pattern.targets) {
        if (target.id === page.id || linked.has(target.id)) continue;
        const known = hits.get(target.id);
        if (known) known.count += 1;
        else hits.set(target.id, { id: target.id, title: target.title, count: 1, ...contextAt(page.lines[lineIndex] ?? '', at, pattern.title.length) });
      }
    });
  });
  return hits;
}

const byCountThenTitle = (a: Mention, b: Mention): number => b.count - a.count || a.title.localeCompare(b.title, 'ko');
const total = (group: MentionGroup): number => group.mentions.reduce((sum, mention) => sum + mention.count, 0);

/** 찾은 제목 수 많은 순 → 나온 횟수 합 많은 순 → 제목 순(F-24). 나눠서 계산한 묶음을 다 모은 뒤 한 번 정렬한다. */
export function sortGroups(groups: MentionGroup[]): MentionGroup[] {
  return groups.sort((a, b) => b.mentions.length - a.mentions.length || total(b) - total(a) || a.title.localeCompare(b.title, 'ko'));
}

/**
 * 글자가 적힌 페이지별 연결 안 된 언급(F-23). `linksFrom(id)`는 그 페이지가 이미 연결한 페이지들이다.
 * 결과를 언급된 페이지별로 다시 묶으면 페이지마다 `findUnlinkedMentions`를 부른 것과 같다(시험으로 확인).
 * 묶음 순서는 정하지 않는다. 나눠서 부른 결과를 모은 뒤 `sortGroups`로 한 번 정렬한다.
 */
export function findAllMentions(
  pages: readonly PreparedText[],
  matcher: Matcher,
  linksFrom: (id: string) => ReadonlySet<string>,
): MentionGroup[] {
  const groups: MentionGroup[] = [];
  for (const page of pages) {
    const hits = hitsIn(matcher, page, linksFrom(page.id));
    if (hits.size > 0) groups.push({ sourceId: page.id, title: page.title, mentions: [...hits.values()].sort(byCountThenTitle) });
  }
  return groups;
}
