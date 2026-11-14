import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoData } from '../src/graph/demoData.ts';
import { buildMatcher, findAllMentions, sortGroups } from '../src/graph/mentionIndex.ts';
import type { MentionGroup } from '../src/graph/mentionIndex.ts';
import { findUnlinkedMentions, normalizeTitle, prepareTexts } from '../src/graph/unlinkedMentions.ts';
import type { Mention } from '../src/graph/unlinkedMentions.ts';
import type { RawLink } from '../src/graph/types.ts';

interface World {
  pages: { id: string; title: string }[];
  texts: { id: string; text: string }[];
  links: RawLink[];
}

const linksFromOf = (links: readonly RawLink[]) => (id: string) => new Set(links.filter((l) => l.from === id).map((l) => l.to));

function allMentions(world: World, ignored: ReadonlySet<string> = new Set()): MentionGroup[] {
  const titleOf = (id: string) => world.pages.find((p) => p.id === id)?.title;
  return sortGroups(findAllMentions(prepareTexts(world.texts, titleOf), buildMatcher(world.pages, ignored), linksFromOf(world.links)));
}

// 언급 정리 결과를 언급된 페이지별로 다시 묶은 것이, 페이지마다 서랍 칸 찾기를 부른 것과 같아야 한다(F-23)
function assertSameAsPerPage(world: World): void {
  const titleOf = (id: string) => world.pages.find((p) => p.id === id)?.title;
  const prepared = prepareTexts(world.texts, titleOf);
  const byTarget = new Map<string, Mention[]>();
  for (const group of allMentions(world)) {
    for (const mention of group.mentions) {
      const list = byTarget.get(mention.id) ?? [];
      list.push({ ...mention, id: group.sourceId, title: group.title });
      byTarget.set(mention.id, list);
    }
  }
  assert.ok(byTarget.size > 2, '찾은 것이 있어야 의미 있는 비교다');
  for (const target of world.pages) {
    const linkedFrom = new Set(world.links.filter((l) => l.to === target.id).map((l) => l.from));
    const expected = findUnlinkedMentions(target, prepared, linkedFrom);
    const sort = (list: Mention[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(sort(byTarget.get(target.id) ?? []), sort(expected === 'too-short' ? [] : expected), target.title);
  }
}

test('언급 정리: 글자가 적힌 페이지별로 묶고, 겹치는 제목·같은 제목 두 페이지도 찾는다(F-23)', () => {
  const world: World = {
    pages: [
      { id: 'meet', title: '회의록' },
      { id: 'meet2', title: '회의록' },
      { id: 'talk', title: '회의 메모' },
      { id: 'art', title: 'Art' },
      { id: 'src', title: '일지' },
    ],
    texts: [{ id: 'src', text: '오늘 회의록에서 회의 메모를 봤다 ART\nstart 회의록' }],
    links: [{ from: 'src', to: 'meet2' }],
  };
  const groups = allMentions(world);
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0]?.mentions.map((m) => [m.id, m.count]),
    [['meet', 2], ['talk', 1], ['art', 1]],
    '이미 연결된 meet2는 빠지고, art는 "start" 안에서 세지 않는다',
  );
  assert.deepEqual(allMentions(world, new Set([normalizeTitle('회의록') as string]))[0]?.mentions.map((m) => m.id), ['talk', 'art'], '뺀 제목(한국어 정렬이라 한글 제목이 앞)');
});

test('언급 정리 = 페이지마다 서랍 칸 찾기: 예시 데이터와 무작위 데이터(F-23)', () => {
  const sample = demoData();
  assertSameAsPerPage({ pages: sample.pages, texts: sample.texts, links: sample.links });

  // 고정 씨앗의 무작위: 제목 조각을 섞어 겹치는 제목·대소문자·경계·같은 제목이 자주 나오게 한다
  let seed = 7;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const words = ['회의', '회의록', '로드맵', 'API', 'api 명세', 'Art', 'start', '디자인', '디자인 시스템', '😀메모', 'aaa', 'aaaa'];
  const pages = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, title: words[random(words.length)] as string }));
  const texts = pages.map((page) => ({
    id: page.id,
    text: Array.from({ length: 4 }, () => Array.from({ length: 6 }, () => words[random(words.length)]).join(random(2) ? ' ' : '')).join('\n'),
  }));
  const links = Array.from({ length: 20 }, () => ({ from: `p${random(30)}`, to: `p${random(30)}` }));
  assertSameAsPerPage({ pages, texts, links });
});

test('언급 정리 순서: 찾은 제목 수 → 횟수 합 → 제목, 묶음 안은 횟수 → 제목(F-24)', () => {
  const world: World = {
    pages: ['가나다', '라마바', '사아자'].map((title, i) => ({ id: `t${i}`, title })).concat(
      ['하나', '둘째', '셋째'].map((title, i) => ({ id: `s${i}`, title: `${title} 페이지` })),
    ),
    texts: [
      { id: 's0', text: '가나다' },
      { id: 's1', text: '라마바 가나다 가나다' },
      { id: 's2', text: '라마바 사아자' },
    ],
    links: [],
  };
  const groups = allMentions(world);
  assert.deepEqual(groups.map((g) => g.title), ['둘째 페이지', '셋째 페이지', '하나 페이지']);
  assert.deepEqual(groups[0]?.mentions.map((m) => m.title), ['가나다', '라마바']);
});
