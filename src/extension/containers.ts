import type { Message } from './messages.ts';

const FULL_PAGE = 'graph.html?mode=full';

/** 사이드 패널은 사용자 동작 안에서 바로 열어야 해서, 기다림 없이 호출을 넘긴다. */
export function openSidePanel(windowId: number): Promise<void> {
  return chrome.sidePanel.open({ windowId });
}

export async function toggleOverlay(tabId: number): Promise<void> {
  await chrome.tabs.sendMessage(tabId, { type: 'toggle-overlay' } satisfies Message);
}

/** 전체 모드 탭. 이미 열려 있으면 새로 열지 않고 그 탭을 앞으로 가져온다(`tabs` 권한 없이 탭 번호를 저장해 둔다). */
export async function openFullTab(): Promise<void> {
  const { fullTabId } = await chrome.storage.session.get('fullTabId');
  if (typeof fullTabId === 'number') {
    const tab = await chrome.tabs.update(fullTabId, { active: true }).catch(() => undefined);
    if (tab) {
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  }
  const created = await chrome.tabs.create({ url: chrome.runtime.getURL(FULL_PAGE) });
  await chrome.storage.session.set({ fullTabId: created.id });
}

/** 전체 모드 탭이 닫히면 저장해 둔 탭 번호를 지운다. */
export async function forgetFullTab(closedTabId: number): Promise<void> {
  const { fullTabId } = await chrome.storage.session.get('fullTabId');
  if (fullTabId === closedTabId) await chrome.storage.session.remove('fullTabId');
}
