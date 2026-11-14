import '../ui.css';
import './options.css';
import { createAnnouncer } from '../announce.ts';
import { openIdbStore } from '../background/idbStore.ts';
import { IDLE_PROGRESS } from '../background/types.ts';
import type { Progress } from '../background/types.ts';
import { openDemoTab, openFullTab } from '../containers.ts';
import { byId } from '../dom.ts';
import type { IndexCommand, Message, SaveTokenReply, TokenKind } from '../messages.ts';
import { autoRefreshMinutes } from '../autoRefresh.ts';
import { describeProgress, keepTimeFresh } from '../progressText.ts';
import { hasToken as tokenPresent, tokenChanged } from '../tokenStore.ts';
import { computeSteps, STEP_STATE_TEXT } from './steps.ts';
import { renderUnreadable } from './view.ts';

const store = openIdbStore();
const startButton = byId<HTMLButtonElement>('index-start');
const stopButton = byId<HTMLButtonElement>('index-stop');
const clearButton = byId<HTMLButtonElement>('index-clear');
const graphButton = byId<HTMLButtonElement>('open-graph');
const announce = createAnnouncer(byId('progress-live'));
let progress: Progress = IDLE_PROGRESS;
let hasToken = false;

const selectedKind = (): TokenKind => (byId<HTMLInputElement>('kind-pat').checked ? 'pat' : 'internal');

async function send<T>(message: Message): Promise<T> {
  return (await chrome.runtime.sendMessage(message)) as T;
}

function startLabel(phase: Progress['phase']): string {
  if (phase === 'paused' || phase === 'error') return '이어서 만들기';
  return phase === 'done' ? '다시 만들기' : '연결 지도 만들기';
}

function renderSteps(): void {
  byId('steps').replaceChildren(
    ...computeSteps(hasToken, progress.phase).map((step) => {
      const item = document.createElement('li');
      item.dataset.state = step.state;
      item.textContent = `${step.label} — ${STEP_STATE_TEXT[step.state]}`;
      return item;
    }),
  );
}

function savedMessage(reply: Extract<SaveTokenReply, { ok: true }>): string {
  if (reply.pageCount === undefined) return '토큰을 저장했어요. 이제 "연결 지도 만들기"를 눌러 주세요.';
  if (reply.pageCount === 0) {
    return '토큰을 저장했지만 읽을 수 있는 페이지가 아직 없어요. Notion에서 상위 페이지의 ⋯ → 연결로 이 연결을 추가한 뒤 "연결 지도 만들기"를 눌러 주세요. 방금 추가했다면 1분쯤 뒤에 누르세요.';
  }
  return `토큰을 저장했어요. 읽을 수 있는 페이지를 ${reply.pageCount}개${reply.more ? ' 이상' : ''} 찾았어요. 이제 "연결 지도 만들기"를 눌러 주세요.`;
}

// 토큰이 없으면 눌러도 오류만 나므로 시작 버튼을 끄고 이유를 보여 준다
function render(): void {
  renderSteps();
  byId('progress').textContent = describeProgress(progress);
  const running = progress.phase === 'running';
  startButton.textContent = startLabel(progress.phase);
  startButton.disabled = running || !hasToken;
  byId('start-hint').hidden = hasToken;
  stopButton.disabled = !running;
  graphButton.disabled = progress.phase === 'idle';
  byId('token-status').textContent ||= hasToken
    ? '토큰이 저장돼 있어요. 바꾸려면 새 토큰을 넣고 다시 저장하세요.'
    : '아직 토큰이 없어요.';
}

function setProgress(next: Progress): void {
  progress = next;
  announce(next);
  render();
}

async function refreshUnreadable(): Promise<void> {
  renderUnreadable(byId('unreadable-list'), byId('unreadable-summary'), await store.listPages());
}

const autoRefresh = byId<HTMLSelectElement>('auto-refresh');
autoRefresh.addEventListener('change', () => {
  chrome.storage.local.set({ autoRefreshMinutes: Number(autoRefresh.value) }).catch((error: unknown) => {
    byId('auto-refresh-status').textContent = `저장하지 못했어요: ${error instanceof Error ? error.message : String(error)}`;
  });
});
keepTimeFresh(byId('progress'), () => progress);

function renderAutoRefreshError(message: unknown): void {
  byId('auto-refresh-status').textContent = typeof message === 'string' ? `자동 다시 만들기에 문제가 생겼어요: ${message}` : '';
}

async function loadInitialState(): Promise<void> {
  const [stored, present] = await Promise.all([chrome.storage.local.get(['tokenKind', 'tokenInSession', 'progress', 'autoRefreshMinutes', 'autoRefreshError']), tokenPresent()]);
  sessionBox.checked = stored.tokenInSession === true;
  autoRefresh.value = String(autoRefreshMinutes(stored.autoRefreshMinutes));
  renderAutoRefreshError(stored.autoRefreshError);
  hasToken = present;
  byId<HTMLInputElement>('kind-pat').checked = stored.tokenKind === 'pat';
  byId('pat-warning').hidden = stored.tokenKind !== 'pat';
  setProgress((stored.progress as Progress | undefined) ?? IDLE_PROGRESS);
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
  status.textContent = 'Notion에 확인하는 중이에요…';
  const reply = await send<SaveTokenReply>({ type: 'save-token', token: input.value, kind: selectedKind() });
  input.setAttribute('aria-invalid', String(!reply.ok));
  if (reply.ok) input.value = '';
  status.textContent = reply.ok ? savedMessage(reply) : reply.message;
});

// 토큰 보안(P2-6): 브라우저를 닫으면 지우기(메모리에만 두기), 토큰만 지우기. 실제로 옮기거나 지우는 일은 서비스 워커가 한다
const sessionBox = byId<HTMLInputElement>('token-session');
async function tokenCommand(message: Message, failure: string): Promise<boolean> {
  const reply = await send<{ ok: boolean; message?: string }>(message);
  if (!reply.ok) byId('token-status').textContent = `${failure}: ${reply.message ?? ''}`;
  return reply.ok;
}
// 옮기는 동안은 다시 못 누르게 하고, 실패하면 실제 저장 상태로 되돌린다
sessionBox.addEventListener('change', () => {
  sessionBox.disabled = true;
  void tokenCommand({ type: 'token-session', sessionOnly: sessionBox.checked }, '토큰 저장 방식을 바꾸지 못했어요')
    .then(async (ok) => {
      if (!ok) sessionBox.checked = (await chrome.storage.local.get('tokenInSession')).tokenInSession === true;
    })
    .finally(() => {
      sessionBox.disabled = false;
    });
});
byId('token-clear').addEventListener('click', () => {
  if (window.confirm('저장된 토큰을 지울까요? 연결 지도는 남고, 다시 만들거나 자동으로 다시 만들려면 토큰을 다시 넣어야 해요.')) {
    void tokenCommand({ type: 'clear-token' }, '토큰을 지우지 못했어요');
  }
});

async function runCommand(command: IndexCommand): Promise<void> {
  await send({ type: 'index', command });
  await refreshUnreadable();
}

startButton.addEventListener('click', () => void runCommand('start'));
stopButton.addEventListener('click', () => void runCommand('stop'));
clearButton.addEventListener('click', () => {
  if (window.confirm('저장된 연결 지도를 지울까요? 토큰은 남고, 다시 만들려면 몇 분 걸려요.')) void runCommand('clear');
});
byId('open-demo').addEventListener('click', () => void openDemoTab());
// 설정 화면에서 여는 그래프에는 "지금 보던 페이지"가 없으므로 이전 클릭의 강조를 지우고, 이미 열린 전체 탭은 재사용한다
graphButton.addEventListener('click', () => {
  void chrome.storage.session.set({ focusPageId: null }).then(openFullTab);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (tokenChanged(changes, area)) {
    void tokenPresent().then((present) => {
      hasToken = present;
      render();
    });
  }
  if (area !== 'local') return;
  if (changes.tokenInSession) sessionBox.checked = changes.tokenInSession.newValue === true;
  if (changes.autoRefreshError) renderAutoRefreshError(changes.autoRefreshError.newValue);
  const next = changes.progress?.newValue as Progress | undefined;
  if (!next) return;
  setProgress(next);
  if (next.phase !== 'running') void refreshUnreadable();
});

void loadInitialState();
