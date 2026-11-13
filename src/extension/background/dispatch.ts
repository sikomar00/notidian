import { urlToPageId } from '../../notion/urlToPageId.ts';
import { forgetFullTab, openFullTab, openSidePanel, toggleOverlay } from '../containers.ts';
import { isViewMode } from '../messages.ts';
import { hasToken, tokenChanged } from '../tokenStore.ts';
import type { ViewMode } from '../messages.ts';

// 사이드 패널은 클릭 처리 안에서 바로 열어야 해서, 모드와 준비 상태를 메모리에 올려 두고 기다림 없이 분기한다
let viewMode: ViewMode = 'side';
let ready = false;
let loaded = false;

// 토큰은 "브라우저를 닫으면 지우기"를 켜면 메모리 저장소(session)에 있어서 두 곳을 함께 본다.
// 색인 중에는 진행 상태가 자주 바뀌므로, 토큰은 토큰이 바뀌었을 때만 다시 읽는다
let tokenPresent = false;
async function refreshState(rereadToken: boolean): Promise<void> {
  const [stored, present] = await Promise.all([chrome.storage.local.get(['viewMode', 'progress']), rereadToken ? hasToken() : tokenPresent]);
  tokenPresent = present;
  if (isViewMode(stored.viewMode)) viewMode = stored.viewMode;
  const phase = (stored.progress as { phase?: string } | undefined)?.phase;
  ready = tokenPresent && phase !== undefined && phase !== 'idle';
}

const loading = refreshState(true).then(() => {
  loaded = true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  const token = tokenChanged(changes, area);
  if (area === 'local' || token) void refreshState(token);
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

// 그것마저 실패하면 아이콘에 "!"와 이유를 남겨, 눌러도 아무 일이 없는 것처럼 보이지 않게 한다
function showOpenFailure(error: unknown): void {
  void chrome.action.setBadgeText({ text: '!' });
  void chrome.action.setTitle({ title: `Notidian: 그래프를 열지 못했어요. 다시 눌러 주세요 (${error instanceof Error ? error.message : String(error)})` });
}

function clearOpenFailure(): void {
  void chrome.action.setBadgeText({ text: '' });
  void chrome.action.setTitle({ title: chrome.runtime.getManifest().action?.default_title ?? 'Notidian' });
}

// 사이드 패널이 거절되거나(서비스 워커가 막 깨어난 첫 클릭) Notion 탭에 오버레이를 못 띄우면 아무 일도 안 일어나지 않게 전체 모드로 대신 연다
async function fallbackToFullTab(mode: ViewMode, error: unknown): Promise<void> {
  if (!ready || mode === 'full') {
    showOpenFailure(error);
    return;
  }
  try {
    await openFullTab();
    clearOpenFailure();
  } catch (fallbackError) {
    showOpenFailure(fallbackError);
  }
}

chrome.action.onClicked.addListener((tab) => {
  const cold = !loaded;
  const opened = cold ? loading.then(() => open(viewMode, tab)) : open(viewMode, tab);
  const mode = viewMode;
  void opened.then(clearOpenFailure, (error: unknown) => fallbackToFullTab(mode, error));
});
