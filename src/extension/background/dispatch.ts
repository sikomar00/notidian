import { urlToPageId } from '../../notion/urlToPageId.ts';
import { forgetFullTab, openFullTab, openSidePanel, toggleOverlay } from '../containers.ts';
import { isViewMode } from '../messages.ts';
import type { ViewMode } from '../messages.ts';

// 사이드 패널은 클릭 처리 안에서 바로 열어야 해서, 모드와 준비 상태를 메모리에 올려 두고 기다림 없이 분기한다
let viewMode: ViewMode = 'side';
let ready = false;
let loaded = false;

function applyStored(stored: Record<string, unknown>): void {
  if (isViewMode(stored.viewMode)) viewMode = stored.viewMode;
  const phase = (stored.progress as { phase?: string } | undefined)?.phase;
  ready = typeof stored.token === 'string' && stored.token !== '' && phase !== undefined && phase !== 'idle';
}

const loading = chrome.storage.local.get(['viewMode', 'token', 'progress']).then((stored) => {
  applyStored(stored);
  loaded = true;
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void chrome.storage.local.get(['viewMode', 'token', 'progress']).then(applyStored);
});

chrome.tabs.onRemoved.addListener((tabId) => void forgetFullTab(tabId));

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

// 아이콘을 누른 순간의 Notion 탭과 그 페이지 ID를 기억해 그래프가 그 점을 강조하게 한다
function remember(tab: chrome.tabs.Tab): void {
  const pageId = tab.url ? urlToPageId(tab.url) : null;
  void chrome.storage.session.set({ originTabId: tab.id ?? null, focusPageId: pageId });
}

function open(mode: ViewMode, tab: chrome.tabs.Tab): Promise<unknown> {
  if (!ready) return chrome.runtime.openOptionsPage();
  remember(tab);
  if (mode === 'side') return openSidePanel(tab.windowId);
  if (mode === 'center' && tab.id !== undefined) return toggleOverlay(tab.id);
  return openFullTab();
}

chrome.action.onClicked.addListener((tab) => {
  const cold = !loaded;
  const opened = cold ? loading.then(() => open(viewMode, tab)) : open(viewMode, tab);
  const mode = viewMode;
  void opened
    .then(() => 'ok')
    .catch((error: unknown) => String(error))
    .then((result) => chrome.storage.session.set({ lastClick: { at: Date.now(), cold, mode, ready, result } }));
});
