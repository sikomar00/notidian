import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contrastRatio } from '../src/graph/contrast.ts';
import { DARK, LIGHT } from '../src/extension/graph-view/palette.ts';

// 화면 공통 디자인(ui.css)의 색을 밝은·어두운 테마별로 읽어 대비를 검사한다(NF-3)
const css = readFileSync(new URL('../src/extension/ui.css', import.meta.url), 'utf8');
const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1] as string, m[2] as string]));
}

for (const [name, block, palette] of [['밝은 테마', css.slice(0, darkStart), LIGHT], ['어두운 테마', css.slice(darkStart), DARK]] as const) {
  test(`${name} 화면 색: 글자 4.5:1, 입력칸 테두리·초점 3:1 이상, 바탕·글자는 그래프 팔레트와 같다(NF-3)`, () => {
    const t = tokens(block);
    const ratio = (fg = '', bg = '') => contrastRatio(t[fg] as string, t[bg] as string);
    for (const [fg, bg] of [['text', 'bg'], ['text', 'surface'], ['text', 'hover'], ['text', 'pressed'], ['muted', 'bg'], ['muted', 'surface'], ['on-accent', 'accent'], ['accent', 'bg'], ['danger', 'bg']]) {
      assert.ok(ratio(fg, bg) >= 4.5, `${fg}/${bg} ${ratio(fg, bg).toFixed(2)}`);
    }
    // 입력칸 테두리, 고른 세그먼트 테두리(회색 묶음 위), 고른 검색 후보 막대, 초점 테두리
    for (const [fg, bg] of [['border-strong', 'bg'], ['border-strong', 'surface'], ['accent', 'pressed'], ['ring', 'bg'], ['ring', 'surface']]) {
      assert.ok(ratio(fg, bg) >= 3, `${fg}/${bg} ${ratio(fg, bg).toFixed(2)}`);
    }
    assert.deepEqual([t.bg, t.text], [palette.background, palette.text]);
  });
}
