import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contrastRatio } from '../src/graph/contrast.ts';
import { neighborMap } from '../src/graph/neighbors.ts';
import { DARK, databaseColors, LIGHT } from '../src/extension/graph-view/palette.ts';
import type { Palette } from '../src/extension/graph-view/palette.ts';
import { isNotionAppUrl, pageUrl } from '../src/notion/urlToPageId.ts';

const ID = '12345678-9abc-4def-8123-456789abcdef';

for (const [name, palette] of [['밝은 테마', LIGHT], ['어두운 테마', DARK]] as [string, Palette][]) {
  test(`${name}: 글자는 4.5:1, 점·선·강조는 3:1 이상(NF-3)`, () => {
    assert.ok(contrastRatio(palette.text, palette.background) >= 4.5, '글자');
    for (const key of ['page', 'dbItem', 'unreadable', 'link', 'linkActive', 'focus'] as const) {
      const ratio = contrastRatio(palette[key], palette.background);
      assert.ok(ratio >= 3, `${key} ${ratio.toFixed(2)}`);
    }
    // 색 그룹 여섯 색(F-35)도 바탕과 3:1 이상이고 서로 다른 색이다
    assert.equal(new Set(palette.groups).size, 6);
    for (const color of palette.groups) assert.ok(contrastRatio(color, palette.background) >= 3, `group ${color} ${contrastRatio(color, palette.background).toFixed(2)}`);
  });
}

test('이웃 계산은 방향을 무시한다', () => {
  const map = neighborMap([
    { source: 'a', target: 'b' },
    { source: 'c', target: 'a' },
  ]);
  assert.deepEqual([...(map.get('a') ?? [])].sort(), ['b', 'c']);
  assert.deepEqual([...(map.get('b') ?? [])], ['a']);
  assert.equal(map.get('x'), undefined);
});

test('이동할 주소: 저장된 주소가 맞으면 그대로, 아니면 ID로 만든다', () => {
  const stored = `https://app.notion.com/p/${ID.replaceAll('-', '')}?pvs=204`;
  assert.equal(pageUrl(ID, stored), stored);
  assert.equal(pageUrl(ID, ''), `https://app.notion.com/p/${ID.replaceAll('-', '')}`);
  assert.equal(pageUrl(ID, 'https://evil.com/x'), `https://app.notion.com/p/${ID.replaceAll('-', '')}`);
  assert.equal(pageUrl(ID, 'https://app.notion.com/p/00000000000000000000000000000001'), `https://app.notion.com/p/${ID.replaceAll('-', '')}`);
});

test('Notion 웹앱 탭인지 판별한다', () => {
  assert.equal(isNotionAppUrl('https://app.notion.com/p/abc'), true);
  assert.equal(isNotionAppUrl('http://app.notion.com/'), false);
  assert.equal(isNotionAppUrl('https://app.notion.com.evil.com/'), false);
  assert.equal(isNotionAppUrl(undefined), false);
  assert.equal(isNotionAppUrl('쓰레기'), false);
});

test('DB별 색: 처음 알게 된 두 DB에 색, 나머지는 기타 DB, 새 DB가 생겨도 기존 색 유지(P2-3)', () => {
  const two = databaseColors(['a', 'b'], LIGHT);
  const four = databaseColors(['a', 'b', 'c', 'd'], LIGHT);
  assert.deepEqual([four.get('a'), four.get('b'), four.get('c'), four.get('d')], [...LIGHT.databases, LIGHT.otherDatabase, LIGHT.otherDatabase]);
  assert.deepEqual([two.get('a'), two.get('b')], [four.get('a'), four.get('b')]);
  // 가는 선 색은 보통 선보다 대비가 커야 한다(가는 선은 테두리가 흐려진다)
  for (const palette of [LIGHT, DARK]) assert.ok(contrastRatio(palette.thinLink, palette.background) > contrastRatio(palette.link, palette.background), '가는 선');
  // 첫 DB는 DB별 색을 켜도 원래 DB 색 그대로, 기타 DB는 "읽을 수 없음"과 다른 색
  for (const palette of [LIGHT, DARK]) {
    assert.equal(palette.databases[0], palette.dbItem);
    assert.notEqual(palette.otherDatabase, palette.unreadable);
  }
  for (const palette of [LIGHT, DARK]) {
    for (const color of [...palette.databases, palette.otherDatabase]) assert.ok(contrastRatio(color, palette.background) >= 3, color);
  }
});
