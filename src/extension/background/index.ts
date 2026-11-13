import './dispatch.ts';
import type { Message } from '../messages.ts';
import { handleIndexCommand, saveToken } from './indexer.ts';
import { relayNotionRequest } from './relay.ts';

const EXTENSION_PAGES = chrome.runtime.getURL('');

chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  // 토큰·색인·Notion 요청은 확장 자신의 페이지에서만 받는다(콘텐츠 스크립트는 notion 페이지 주소로 보인다)
  const fromExtensionPage = sender.url?.startsWith(EXTENSION_PAGES) === true;
  if (message.type === 'close-overlay' && sender.tab?.id !== undefined) {
    void chrome.tabs.sendMessage(sender.tab.id, message).catch(() => undefined);
    return false;
  }
  if (!fromExtensionPage) return false;
  if (message.type === 'notion-request') {
    void relayNotionRequest(message.req).then(sendResponse);
    return true;
  }
  if (message.type === 'save-token') {
    void saveToken(message.token, message.kind).then(sendResponse);
    return true;
  }
  if (message.type === 'index') {
    void handleIndexCommand(message.command).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
