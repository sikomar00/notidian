// public/icons/icon.svg를 확장 아이콘 PNG(16·32·48·128)로 바꾼다. 새 라이브러리 없이 헤드리스 Chrome의 스크린샷 기능을 쓴다
// (Chrome이 페이지를 다 그린 뒤 찍는다). 사용: node scripts/make-icons.ts — 아이콘 모양을 바꿀 때만 다시 돌린다
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SIZES = [16, 32, 48, 128];
const svg = readFileSync('public/icons/icon.svg', 'utf8');
const work = mkdtempSync(join(tmpdir(), 'notidian-icons-'));
try {
  for (const size of SIZES) {
    const page = join(work, `icon-${size}.html`);
    writeFileSync(page, `<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    const out = resolve(`public/icons/icon-${size}.png`);
    // 투명 배경(둥근 모서리 바깥), 창 크기 = 아이콘 크기
    const flags = ['--headless=new', `--user-data-dir=${join(work, 'profile')}`, '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${size},${size}`, `--screenshot=${out}`];
    execFileSync(CHROME, [...flags, pathToFileURL(page).href], { stdio: 'ignore' });
    console.log(out);
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
