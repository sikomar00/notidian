import type { TokenKind } from './messages.ts';

// 토큰은 기본으로 storage.local(디스크)에 두고, "브라우저를 닫으면 토큰 지우기"를 켜면 storage.session(메모리)에 둔다(P2-6).
// storage.session은 브라우저를 닫거나 확장을 새로고침·업데이트하면 사라지고 디스크에 남지 않으며, 기본으로 확장 자신의
// 화면·서비스 워커만 읽을 수 있다(Notion 페이지에 들어가는 스크립트는 못 읽는다).
// 화면(설정·그래프)은 토큰이 있는지만 보고, 토큰을 쓰거나 옮기거나 지우는 일은 서비스 워커가 이 파일로만 한다.

const isToken = (value: unknown): value is string => typeof value === 'string' && value !== '';

export async function readToken(): Promise<string | undefined> {
  const [session, local] = await Promise.all([chrome.storage.session.get('token'), chrome.storage.local.get('token')]);
  if (isToken(session.token)) return session.token;
  return isToken(local.token) ? local.token : undefined;
}

export async function hasToken(): Promise<boolean> {
  return (await readToken()) !== undefined;
}

/** 저장소 변경 알림 중 토큰이 바뀐 것(어느 쪽 저장소든)인지. */
export function tokenChanged(changes: Record<string, chrome.storage.StorageChange>, area: string): boolean {
  return (area === 'local' || area === 'session') && 'token' in changes;
}

// 쓰기·옮기기·지우기는 저장소를 여러 번 오가서, 겹치면 토큰이 두 곳에서 다 지워지거나 지운 토큰이 되살아난다.
// 그래서 하나씩 차례로 한다(앞 작업이 실패해도 다음 작업은 한다)
let queue: Promise<unknown> = Promise.resolve();
function inTurn(task: () => Promise<void>): Promise<void> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

// 고른 쪽에 쓰고 다른 쪽에서는 지운다(두 곳에 남지 않게)
async function place(token: string, inSession: boolean): Promise<void> {
  const [target, other] = inSession ? [chrome.storage.session, chrome.storage.local] : [chrome.storage.local, chrome.storage.session];
  await target.set({ token });
  await other.remove('token');
}

export function writeToken(token: string, kind: TokenKind): Promise<void> {
  return inTurn(async () => {
    const { tokenInSession } = await chrome.storage.local.get('tokenInSession');
    await place(token, tokenInSession === true);
    await chrome.storage.local.set({ tokenKind: kind });
  });
}

/** "브라우저를 닫으면 토큰 지우기"를 바꾸고, 저장된 토큰을 그쪽으로 옮긴다. */
export function setSessionOnly(inSession: boolean): Promise<void> {
  return inTurn(async () => {
    await chrome.storage.local.set({ tokenInSession: inSession });
    const token = await readToken();
    if (token) await place(token, inSession);
  });
}

/** 토큰을 두 저장소에서 모두 지운다. 연결 지도는 남긴다. */
export function clearToken(): Promise<void> {
  return inTurn(async () => {
    await Promise.all([chrome.storage.local.remove(['token', 'tokenKind']), chrome.storage.session.remove('token')]);
  });
}
