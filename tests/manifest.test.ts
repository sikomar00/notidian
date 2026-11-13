import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8')) as {
  permissions: string[];
  host_permissions: string[];
  content_scripts: { matches: string[] }[];
  web_accessible_resources: { matches: string[] }[];
  description: string;
  icons: Record<string, string>;
  action: { default_icon: Record<string, string> };
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

test('권한은 api.notion.com과 app.notion.com 두 곳뿐이다(NF-4)', () => {
  assert.deepEqual([...manifest.host_permissions].sort(), ['https://api.notion.com/*', 'https://app.notion.com/*']);
  assert.deepEqual(manifest.content_scripts.flatMap((script) => script.matches), ['https://app.notion.com/*']);
  assert.deepEqual(manifest.web_accessible_resources.flatMap((entry) => entry.matches), ['https://app.notion.com/*']);
});

test('확장 권한은 storage·sidePanel·alarms뿐이고 tabs 권한은 없다', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'sidePanel', 'storage']);
});

test('네트워크 요청은 src/notion/http.ts 한 곳에서만 보낸다(NF-4, NF-5)', () => {
  const offenders = sourceFiles(join(root, 'src')).filter((file) => {
    if (file.endsWith(join('notion', 'http.ts'))) return false;
    return /\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(readFileSync(file, 'utf8'));
  });
  assert.deepEqual(offenders, []);
});

test('콘솔에 아무것도 찍지 않는다 — 토큰이 로그에 새지 않게(NF-4)', () => {
  const offenders = sourceFiles(join(root, 'src')).filter((file) => /\bconsole\./.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('아이콘 파일이 모두 있고, 설명은 웹스토어 한도(132자) 안이다(P1-8)', () => {
  for (const path of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) {
    assert.ok(existsSync(join(root, 'public', path)), path);
  }
  assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
  // PNG 머리(IHDR)의 가로·세로가 매니페스트에 적힌 크기와 같아야 한다
  for (const [size, path] of Object.entries(manifest.icons)) {
    const png = readFileSync(join(root, 'public', path));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [Number(size), Number(size)], path);
  }
  assert.ok(manifest.description.length <= 132, String(manifest.description.length));
});
