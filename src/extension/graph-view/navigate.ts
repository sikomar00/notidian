import { isNotionAppUrl } from '../../notion/urlToPageId.ts';
import { openFullTab, openSidePanel, toggleOverlay } from '../containers.ts';
import type { Message, ViewMode } from '../messages.ts';

/** 점을 누르면 그 Notion 페이지로 간다. 사이드·중앙은 지금 보던 Notion 탭에서, 전체는 새 탭으로 연다. */
export async function openPage(mode: ViewMode, url: string): Promise<void> {
  if (mode === 'full') {
    await chrome.tabs.create({ url });
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (mode === 'center') void chrome.runtime.sendMessage({ type: 'close-overlay' } satisfies Message);
  if (tab?.id !== undefined && isNotionAppUrl(tab.url)) await chrome.tabs.update(tab.id, { url });
  else await chrome.tabs.create({ url });
}

async function openContainer(target: ViewMode): Promise<string | undefined> {
  if (target === 'full') {
    await openFullTab();
    return undefined;
  }
  if (target === 'side') {
    const current = await chrome.windows.getCurrent();
    await openSidePanel(current.id ?? chrome.windows.WINDOW_ID_CURRENT);
    return undefined;
  }
  const { originTabId } = await chrome.storage.session.get('originTabId');
  if (typeof originTabId !== 'number') return '가운데 창은 Notion 페이지에서 Notidian 아이콘을 눌러 열어 주세요.';
  await toggleOverlay(originTabId);
  return undefined;
}

async function closeContainer(current: ViewMode): Promise<void> {
  if (current === 'center') {
    await chrome.runtime.sendMessage({ type: 'close-overlay' } satisfies Message);
  } else if (current === 'side') {
    // sidePanel.close는 Chrome 141부터 있다. 없으면 새 컨테이너만 열고 사이드 패널은 사용자가 닫는다
    if (typeof chrome.sidePanel.close !== 'function') return;
    const window = await chrome.windows.getCurrent();
    await chrome.sidePanel.close({ windowId: window.id ?? chrome.windows.WINDOW_ID_CURRENT });
  } else {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  }
}

/** 보기 모드를 바꾼다(S2-1): 고른 모드를 기억하고, 새 컨테이너를 연 뒤 지금 컨테이너를 닫는다. 실패하면 이유를 돌려준다. */
export async function switchMode(target: ViewMode, current: ViewMode): Promise<string | undefined> {
  await chrome.storage.local.set({ viewMode: target });
  if (target === current) return undefined;
  try {
    const failure = await openContainer(target);
    if (failure) return failure;
    await closeContainer(current);
    return undefined;
  } catch (error) {
    return `열지 못했어요: ${error instanceof Error ? error.message : String(error)}`;
  }
}
