import { urlToPageId } from '../../notion/urlToPageId.ts';

type TabLike = Pick<chrome.tabs.Tab, 'id' | 'windowId' | 'active' | 'url'>;

/** 이 창에서 지금 보이는 Notion 페이지 탭이면 그 페이지 ID, 아니면 null. */
export function followedPage(tab: TabLike, windowId: number | undefined): string | null {
  if (windowId === undefined || tab.windowId !== windowId || !tab.active || tab.id === undefined || !tab.url) return null;
  return urlToPageId(tab.url);
}

/**
 * 옆 패널이 같은 창의 Notion 탭을 따라가게 한다(P1-4). 탭을 바꾸거나, 새로고침 없이 주소만 바뀌는 이동까지 잡는다.
 * 패널이 열려 있는 동안만 동작하고, 다른 창의 탭은 무시한다. 주소는 host_permissions(app.notion.com)로 볼 수 있어 tabs 권한이 필요 없다.
 */
export function followTabs(onPage: (pageId: string, tabId: number) => void): void {
  let windowId: number | undefined;
  // 탭을 빠르게 바꾸면 앞선 탭 조회가 늦게 끝날 수 있어서, 가장 최근 이벤트의 결과만 쓴다
  let ticket = 0;
  const consider = (tab: TabLike): void => {
    const pageId = followedPage(tab, windowId);
    if (pageId !== null && tab.id !== undefined) onPage(pageId, tab.id);
  };
  void chrome.windows.getCurrent().then((current) => {
    windowId = current.id;
  });
  chrome.tabs.onActivated.addListener(({ tabId, windowId: activatedIn }) => {
    if (activatedIn !== windowId) return;
    const mine = ++ticket;
    void chrome.tabs.get(tabId).then(
      (tab) => {
        if (mine === ticket) consider(tab);
      },
      // 바꾼 직후 닫힌 탭은 찾을 수 없고, 따라갈 것도 없다
      () => undefined,
    );
  });
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (!change.url) return;
    ticket += 1;
    consider(tab);
  });
}
