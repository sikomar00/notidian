import { autoRefreshMinutes, shouldAutoRefresh } from '../autoRefresh.ts';
import { hasToken } from '../tokenStore.ts';
import { startIndex } from './indexer.ts';
import { IDLE_PROGRESS } from './types.ts';
import type { Progress } from './types.ts';

// 설정에서 고른 주기마다 바뀐 페이지만 다시 읽는다(P2-4). 알람은 브라우저가 켜져 있을 때만 울린다
const AUTO_ALARM = 'notidian-auto-refresh';

// 서비스 워커가 깨어날 때마다 알람을 새로 걸면 타이머가 처음부터 다시 시작되므로, 주기가 바뀌었거나 알람이 없을 때만 건다
async function applyAlarm(): Promise<void> {
  const { autoRefreshMinutes: stored } = await chrome.storage.local.get('autoRefreshMinutes');
  const minutes = autoRefreshMinutes(stored);
  const existing = await chrome.alarms.get(AUTO_ALARM);
  if (minutes === 0) {
    if (existing) await chrome.alarms.clear(AUTO_ALARM);
    return;
  }
  if (existing?.periodInMinutes !== minutes) await chrome.alarms.create(AUTO_ALARM, { delayInMinutes: minutes, periodInMinutes: minutes });
}

async function refreshIfReady(): Promise<void> {
  const [{ progress, autoRefreshMinutes: stored }, tokenPresent] = await Promise.all([chrome.storage.local.get(['progress', 'autoRefreshMinutes']), hasToken()]);
  const current = (progress as Progress | undefined) ?? IDLE_PROGRESS;
  if (shouldAutoRefresh(current, tokenPresent, autoRefreshMinutes(stored), Date.now())) await startIndex(true);
}

// 실패는 설정 화면에서 보이도록 저장한다(서비스 워커에는 사용자가 볼 화면이 없다)
async function report(task: () => Promise<void>): Promise<void> {
  try {
    await task();
    await chrome.storage.local.remove('autoRefreshError');
  } catch (error) {
    await chrome.storage.local.set({ autoRefreshError: error instanceof Error ? error.message : String(error) });
  }
}

// 설정을 빠르게 바꾸거나 깨어날 때와 겹치면 늦게 끝난 쪽이 이겨 저장값과 알람이 어긋나므로, 하나씩 차례로 맞춘다
let syncing: Promise<void> = Promise.resolve();
function syncAlarm(): void {
  syncing = syncing.then(() => report(applyAlarm));
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_ALARM) void report(refreshIfReady);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.autoRefreshMinutes) syncAlarm();
});
// 브라우저를 다시 켜면 알람이 지워질 수 있어서 시작·설치 때도 맞춘다
chrome.runtime.onStartup.addListener(syncAlarm);
chrome.runtime.onInstalled.addListener(syncAlarm);
syncAlarm();
