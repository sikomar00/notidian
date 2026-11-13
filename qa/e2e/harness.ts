// 자동 화면 점검(P1-9)의 공통 도구: 헤드리스 Chrome을 띄워 dist를 확장으로 올리고, CDP로 화면을 조작·검사한다.
// 새 라이브러리 없이 Node 내장 WebSocket·fetch만 쓴다. 실제 Notion에는 접속하지 않는다:
// 화면의 app.notion.com 요청은 가로채 가짜 페이지로 답하고, 그 밖의 Notion 주소(서비스 워커의 api.notion.com 포함)는 주소를 찾지 못하게 막는다.
import { execFileSync, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

type Json = Record<string, unknown>;
interface CdpMessage {
  id?: number;
  method?: string;
  params?: Json;
  result?: Json;
  error?: { message?: string };
}

export interface Page {
  send(method: string, params?: Json): Promise<Json>;
  /** 페이지 안에서 식을 계산해 값을 돌려준다. 예외가 나면 그 메시지로 실패한다. */
  run(expression: string): Promise<unknown>;
  type(text: string): Promise<void>;
  press(key: 'Enter'): Promise<void>;
  shot(name: string): Promise<void>;
  close(): void;
}

export interface Browser {
  ext(path: string): string;
  open(url: string, options?: { width?: number; height?: number; scheme?: 'light' | 'dark' }): Promise<Page>;
  /** 새 창에 탭을 연다(다른 창 탭을 무시하는지 볼 때). */
  openInNewWindow(url: string): Promise<Page>;
  /** 장면이 중간에 실패해도 다음 장면에 탭이 남지 않게 연 탭을 모두 닫는다. */
  closeTabs(): Promise<void>;
  stop(): void;
}

export type Check = (label: string, ok: boolean, detail?: unknown) => void;

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const CHROME = process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_TIMEOUT_MS = 30_000;

function connect(wsUrl: string, shotDir: string): Page {
  const ws = new WebSocket(wsUrl);
  const pending = new Map<number, { done: (message: CdpMessage) => void; fail: (error: Error) => void }>();
  // 연결이 끊기거나 열리지 않으면 기다리는 요청을 모두 실패시켜, 점검 전체가 멈추지 않게 한다
  const opened = new Promise<void>((done, fail) => {
    ws.addEventListener('open', () => done());
    ws.addEventListener('error', () => fail(new Error('CDP 연결 실패')));
  });
  ws.addEventListener('close', () => {
    for (const { fail } of pending.values()) fail(new Error('CDP 연결이 끊겼어요'));
    pending.clear();
  });
  let nextId = 0;
  const send = async (method: string, params: Json = {}): Promise<Json> => {
    await opened;
    const id = ++nextId;
    const reply = await new Promise<CdpMessage>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`CDP 응답 없음: ${method}`)), CDP_TIMEOUT_MS);
      pending.set(id, { done: (message) => (clearTimeout(timer), done(message)), fail: (error) => (clearTimeout(timer), fail(error)) });
      ws.send(JSON.stringify({ id, method, params }));
    });
    pending.delete(id);
    if (reply.error) throw new Error(`CDP 오류(${method}): ${reply.error.message ?? ''}`);
    return reply.result ?? {};
  };
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (message.id !== undefined) pending.get(message.id)?.done(message);
    if (message.method === 'Fetch.requestPaused') {
      const body = Buffer.from('<title>fake notion</title>').toString('base64');
      const headers = [{ name: 'Content-Type', value: 'text/html' }];
      send('Fetch.fulfillRequest', { requestId: message.params?.requestId, responseCode: 200, responseHeaders: headers, body }).catch((error: unknown) => {
        console.log(`(가짜 Notion 응답 실패: ${error instanceof Error ? error.message : String(error)})`);
      });
    }
  });
  return {
    send,
    async run(expression) {
      const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      const failure = reply.exceptionDetails as { exception?: { description?: string } } | undefined;
      if (failure) throw new Error(`페이지 안 오류: ${(failure.exception?.description ?? '').split('\n')[0]}`);
      return (reply.result as { value?: unknown } | undefined)?.value;
    },
    async type(text) {
      for (const ch of text) await send('Input.dispatchKeyEvent', { type: 'char', text: ch, key: ch });
    },
    async press(key) {
      // 실제 키보드처럼 Enter에는 입력 문자(\r)를 붙여야 버튼이 눌린다
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: 13, text: '\r' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: 13 });
    },
    async shot(name) {
      const { data } = (await send('Page.captureScreenshot', { format: 'png' })) as { data: string };
      writeFileSync(join(shotDir, `${name}.png`), Buffer.from(data, 'base64'));
    },
    close: () => ws.close(),
  };
}

// Chrome이 고른 디버깅 포트(--remote-debugging-port=0)를 프로필의 DevToolsActivePort 파일에서 읽는다. 연달아 돌려도 포트가 부딪히지 않는다
async function devToolsPort(profile: string): Promise<number> {
  for (let i = 0; i < 80; i += 1) {
    const file = join(profile, 'DevToolsActivePort');
    const port = existsSync(file) ? Number(readFileSync(file, 'utf8').split(/\r?\n/)[0]) : 0;
    if (port > 0) return port;
    await sleep(250);
  }
  throw new Error('Chrome 디버깅 연결을 열지 못했어요');
}

// Chrome이 끝난 뒤에도 프로필 파일을 한동안 잡고 있어서, 실행마다 새 프로필을 쓰고 지난 프로필은 지울 수 있을 때 지운다(쌓이지 않게)
function freshProfile(outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  for (const name of readdirSync(outDir).filter((entry) => entry.startsWith('profile-'))) {
    try {
      rmSync(join(outDir, name), { recursive: true, force: true });
    } catch {
      // 아직 Chrome이 잡고 있으면 다음 실행에서 지운다
    }
  }
  const profile = join(outDir, `profile-${Date.now()}`);
  mkdirSync(profile);
  return profile;
}

function kill(chrome: ChildProcess): void {
  try {
    execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    chrome.kill();
  }
}

export async function launch(distDir: string, shotDir: string): Promise<Browser> {
  if (!existsSync(CHROME)) throw new Error(`Chrome을 찾지 못했어요: ${CHROME} (CHROME_PATH 환경 변수로 지정하세요)`);
  if (!existsSync(join(distDir, 'manifest.json'))) throw new Error('dist가 없어요. 먼저 npm run build를 하세요');
  const profile = freshProfile(resolve(shotDir));
  const noNotion = '--host-resolver-rules=MAP api.notion.com ~NOTFOUND, MAP app.notion.com ~NOTFOUND, MAP *.notion.so ~NOTFOUND';
  const flags = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, noNotion, '--no-first-run', '--no-default-browser-check', '--enable-unsafe-extension-debugging', 'about:blank'];
  const chrome = spawn(CHROME, flags, { stdio: 'ignore' });
  try {
    return await attach(chrome, await devToolsPort(profile), distDir, shotDir);
  } catch (error) {
    kill(chrome);
    throw error;
  }
}

async function attach(chrome: ChildProcess, port: number, distDir: string, shotDir: string): Promise<Browser> {
  const http = async (path: string, init?: RequestInit): Promise<unknown> => (await fetch(`http://127.0.0.1:${port}${path}`, init)).json();
  const browser = connect(String(((await http('/json/version')) as Json).webSocketDebuggerUrl), shotDir);
  const extensionId = String((await browser.send('Extensions.loadUnpacked', { path: resolve(distDir) })).id);
  await sleep(1200);
  const tabs: { page: Page; id: string }[] = [];

  async function prepare(target: Json, options: Parameters<Browser['open']>[1] = {}): Promise<Page> {
    const page = connect(String(target.webSocketDebuggerUrl), shotDir);
    tabs.push({ page, id: String(target.id) });
    await page.send('Emulation.setDeviceMetricsOverride', { width: options.width ?? 1280, height: options.height ?? 900, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: options.scheme ?? 'light' }] });
    await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://app.notion.com/*' }] });
    return page;
  }
  return {
    ext: (path) => `chrome-extension://${extensionId}/${path}`,
    async open(url, options) {
      const page = await prepare((await http('/json/new?about:blank', { method: 'PUT' })) as Json, options);
      await page.send('Page.navigate', { url });
      return page;
    },
    async openInNewWindow(url) {
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', newWindow: true });
      const target = ((await http('/json/list')) as Json[]).find((item) => item.id === targetId);
      if (!target) throw new Error('새 창의 탭을 찾지 못했어요');
      const page = await prepare(target);
      await page.send('Page.navigate', { url });
      return page;
    },
    async closeTabs() {
      for (const { page, id } of tabs.splice(0)) {
        page.close();
        await fetch(`http://127.0.0.1:${port}/json/close/${id}`).catch(() => undefined);
      }
    },
    stop() {
      browser.close();
      kill(chrome);
    },
  };
}

/** 페이지 안 식이 참이 될 때까지 기다린다(최대 timeoutMs). */
export async function waitFor(page: Page, expression: string, timeoutMs = 8_000): Promise<boolean> {
  for (const start = Date.now(); Date.now() - start < timeoutMs; await sleep(200)) {
    if ((await page.run(expression).catch(() => false)) === true) return true;
  }
  return false;
}

/** 식이 참이 될 때까지 기다렸다가 결과를 기록한다. 실패하면 `detail` 식의 값을 함께 보여 준다. */
export async function expect(check: Check, page: Page, label: string, expression: string, detail = expression): Promise<void> {
  const ok = await waitFor(page, expression);
  check(label, ok, ok ? undefined : await page.run(detail).catch((error: unknown) => String(error)));
}

/** 결과를 모아 한 줄씩 보여 주고, 끝에 통과 수와 실패 목록을 낸다. */
export function createReport(): { check: Check; finish(): number } {
  const failed: string[] = [];
  let total = 0;
  return {
    check(label, ok, detail) {
      total += 1;
      if (!ok) failed.push(label);
      console.log(`${ok ? '통과' : '실패'}  ${label}${ok || detail === undefined ? '' : `  실제: ${JSON.stringify(detail)}`}`);
    },
    finish() {
      console.log(`\n통과 ${total - failed.length} / ${total}${failed.length ? `\n실패: ${failed.join(', ')}` : ''}`);
      return failed.length;
    },
  };
}
