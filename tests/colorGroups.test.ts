import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assignGroups, groupLabel, MAX_GROUPS, parseGroups } from '../src/graph/colorGroups.ts';
import type { PageRecord } from '../src/graph/types.ts';

const page = (id: string, title: string, extra: Partial<PageRecord> = {}): PageRecord => ({ id, title, kind: 'page', url: '', lastEdited: '', status: 'ok', failCount: 0, ...extra });
const pages = [
  page('a', '11월 회의록'),
  page('b', '프로젝트 A'),
  page('c', '기획', { parentPageId: 'b' }),
  page('d', '세부 회의', { parentPageId: 'c' }),
  page('e', '할 일 1', { kind: 'dbItem', databaseId: 'db1' }),
  page('x', '', { status: 'unreadable' }),
  page('loop1', '고리', { parentPageId: 'loop2' }),
  page('loop2', '고리2', { parentPageId: 'loop1' }),
];

test('색 그룹: 제목 글자(대소문자 무시)·DB·상위 페이지 아래 전부, 위에 있는 그룹이 먼저(F-35·F-36)', () => {
  const groups = [
    { rule: { kind: 'parent' as const, value: 'b' }, color: 0 },
    { rule: { kind: 'title' as const, value: '회의' }, color: 1 },
    { rule: { kind: 'database' as const, value: 'db1' }, color: 2 },
  ];
  const assigned = assignGroups(pages, groups);
  assert.deepEqual(Object.fromEntries(assigned), { c: 0, d: 0, a: 1, e: 2 }, 'd는 "회의"도 들지만 위에 있는 상위 페이지 그룹, b 자신은 아래가 아니다');
  assert.equal(assignGroups(pages, [{ rule: { kind: 'title', value: '  ' }, color: 0 }]).size, 0, '빈 글자는 아무것도 안 칠한다');
  assert.equal(assignGroups(pages, [{ rule: { kind: 'parent', value: 'loop1' }, color: 0 }]).get('loop2'), 0, '상위 관계가 고리여도 멈춘다');
  assert.equal(assignGroups(pages, []).size, 0);
});

test('색 그룹 이름과 저장값 확인', () => {
  const names = { database: (id: string) => `DB ${id}`, page: (id: string) => `페이지 ${id}` };
  assert.equal(groupLabel({ kind: 'title', value: ' 회의 ' }, names), '"회의" 포함');
  assert.equal(groupLabel({ kind: 'database', value: 'db1' }, names), 'DB db1');
  assert.equal(groupLabel({ kind: 'parent', value: 'b' }, names), '페이지 b 아래');
  assert.deepEqual(parseGroups([{ rule: { kind: 'title', value: '회의' }, color: 1 }, { rule: { kind: 'tag', value: 'x' }, color: 0 }, null, 'x']), [{ rule: { kind: 'title', value: '회의' }, color: 1 }]);
  assert.equal(parseGroups(Array.from({ length: 9 }, () => ({ rule: { kind: 'title', value: 'a' }, color: 0 }))).length, MAX_GROUPS);
  assert.deepEqual(parseGroups(undefined), []);
});
