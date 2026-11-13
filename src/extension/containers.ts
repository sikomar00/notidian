import type { Message } from './messages.ts';

const FULL_PAGE = 'graph.html?mode=full';
const DEMO_PAGE = 'graph.html?mode=full&demo=1';

/** 사이드 패널은 사용자 동작 안에서 바로 열어야 해서, 기다림 없이 호출을 넘긴다. */
export function openSidePanel(windowId: number): Promise<void> {
  return chrome.sidePanel.open({ windowId });
}

export async function toggleOverlay(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'toggle-overlay' } satisfies Message);
}

type TabKey = 'fullTabId' | 'demoTabId';

// 이미 열어 둔 탭이 있으면 새로 열지 않고 앞으로 가져온다(`tabs` 권한 없이 탭 번호를 저장해 둔다). `reopen`이면 그 탭의 주소도 다시 연다
async function openRemembered(key: TabKey, page: string, reopen: boolean): Promise<void> {
  const url = chrome.runtime.getURL(page);
  const remembered = (await chrome.storage.session.get(key))[key];
  if (typeof remembered === 'number') {
    const tab = await chrome.tabs.update(remembered, reopen ? { active: true, url } : { active: true }).catch(() => undefined);
    if (tab) {
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  }
  const created = await chrome.tabs.create({ url });
  await chrome.storage.session.set({ [key]: created.id });
}

/** 전체 모드 탭. 이미 열려 있으면 그 탭을 앞으로 가져온다. */
export function openFullTab(): Promise<void> {
  return openRemembered('fullTabId', FULL_PAGE, false);
}

/** 예시 그래프 탭(P2-7). 내 지도 탭과 따로 연다. 예시 탭에서 "돌아가기"를 눌렀을 수 있어서 다시 예시 주소로 연다. */
export function openDemoTab(): Promise<void> {
  return openRemembered('demoTabId', DEMO_PAGE, true);
}

/** 기억해 둔 탭이 닫히면 그 탭 번호를 지운다. */
export async function forgetFullTab(closedTabId: number): Promise<void> {
  const stored = await chrome.storage.session.get(['fullTabId', 'demoTabId']);
  const closed = (['fullTabId', 'demoTabId'] as const).filter((key) => stored[key] === closedTabId);
  if (closed.length > 0) await chrome.storage.session.remove([...closed]);
}
