import { openIdbStore } from '../background/idbStore.ts';
import type { Progress } from '../background/types.ts';
import type { IndexCommand, Message, SaveTokenReply, TokenKind } from '../messages.ts';
import { byId } from '../dom.ts';
import { describeProgress } from '../progressText.ts';
import { renderUnreadable } from './view.ts';

const store = openIdbStore();
const startButton = byId<HTMLButtonElement>('index-start');
const stopButton = byId<HTMLButtonElement>('index-stop');
const clearButton = byId<HTMLButtonElement>('index-clear');
const graphButton = byId<HTMLButtonElement>('open-graph');
const IDLE: Progress = { phase: 'idle', read: 0, discovered: 0 };

const selectedKind = (): TokenKind => (byId<HTMLInputElement>('kind-pat').checked ? 'pat' : 'internal');

async function send<T>(message: Message): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

function startLabel(phase: Progress['phase']): string {
  if (phase === 'paused' || phase === 'error') return '이어서 색인';
  return phase === 'done' ? '다시 색인' : '색인 시작';
}

function renderProgress(progress: Progress): void {
  byId('progress').textContent = describeProgress(progress);
  const running = progress.phase === 'running';
  startButton.textContent = startLabel(progress.phase);
  startButton.disabled = running;
  stopButton.disabled = !running;
  graphButton.disabled = progress.phase === 'idle';
}

async function refreshUnreadable(): Promise<void> {
  renderUnreadable(byId('unreadable-list'), byId('unreadable-summary'), await store.listPages());
}

async function loadInitialState(): Promise<void> {
  const stored = await chrome.storage.local.get(['token', 'tokenKind', 'progress']);
  const hasToken = typeof stored.token === 'string' && stored.token !== '';
  byId<HTMLInputElement>('kind-pat').checked = stored.tokenKind === 'pat';
  byId('pat-warning').hidden = stored.tokenKind !== 'pat';
  byId('token-status').textContent = hasToken ? '토큰이 저장되어 있습니다. 바꾸려면 새 토큰을 넣고 다시 저장하세요.' : '아직 토큰이 없습니다.';
  renderProgress((stored.progress as Progress | undefined) ?? IDLE);
  await refreshUnreadable();
}

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="kind"]')) {
  radio.addEventListener('change', () => {
    byId('pat-warning').hidden = selectedKind() !== 'pat';
  });
}

byId('save-token').addEventListener('click', async () => {
  const input = byId<HTMLInputElement>('token');
  const status = byId('token-status');
  status.textContent = 'Notion에 확인하는 중…';
  const reply = await send<SaveTokenReply>({ type: 'save-token', token: input.value, kind: selectedKind() });
  if (reply.ok) input.value = '';
  status.textContent = reply.ok ? '토큰을 확인하고 저장했습니다.' : reply.message;
});

async function runCommand(command: IndexCommand): Promise<void> {
  await send({ type: 'index', command });
  await refreshUnreadable();
}

startButton.addEventListener('click', () => void runCommand('start'));
stopButton.addEventListener('click', () => void runCommand('stop'));
clearButton.addEventListener('click', () => {
  if (window.confirm('저장된 색인을 지웁니다. 토큰은 지워지지 않습니다. 계속할까요?')) void runCommand('clear');
});
graphButton.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('graph.html?mode=full') });
});

chrome.storage.onChanged.addListener((changes, area) => {
  const progress = changes.progress?.newValue as Progress | undefined;
  if (area !== 'local' || !progress) return;
  renderProgress(progress);
  if (progress.phase !== 'running') void refreshUnreadable();
});

void loadInitialState();
