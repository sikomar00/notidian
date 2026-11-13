import { checkToken } from '../../notion/endpoints.ts';
import { createNotionClient } from '../../notion/http.ts';
import { withRetry } from '../../notion/retry.ts';
import type { IndexCommand, SaveTokenReply, TokenKind } from '../messages.ts';
import { beginCrawl, runCrawl } from './crawl.ts';
import type { CrawlOutcome } from './crawl.ts';
import { openIdbStore } from './idbStore.ts';
import type { Progress } from './types.ts';

const ALARM = 'notidian-resume';
// 서비스 워커는 이벤트 하나가 5분을 넘으면 종료되므로 4분씩 조각내어 돌리고 알람으로 이어 간다
const BUDGET_MS = 4 * 60_000;
const RESUME_DELAY_MIN = 0.5;
const IDLE: Progress = { phase: 'idle', read: 0, discovered: 0 };

const store = openIdbStore();
let running = false;
let stopRequested = false;

async function readProgress(): Promise<Progress> {
  const { progress } = await chrome.storage.local.get('progress');
  return typeof progress === 'object' && progress !== null ? (progress as Progress) : IDLE;
}

async function writeProgress(progress: Progress): Promise<void> {
  await chrome.storage.local.set({ progress });
}

async function readToken(): Promise<string | undefined> {
  const { token } = await chrome.storage.local.get('token');
  return typeof token === 'string' && token !== '' ? token : undefined;
}

async function finish(outcome: CrawlOutcome): Promise<void> {
  const { read, discovered } = await store.counts();
  if (outcome.kind === 'budget') {
    await chrome.alarms.create(ALARM, { delayInMinutes: RESUME_DELAY_MIN });
    return;
  }
  await chrome.alarms.clear(ALARM);
  if (outcome.kind === 'done') await writeProgress({ phase: 'done', read, discovered });
  else if (outcome.kind === 'stopped') await writeProgress({ phase: 'paused', read, discovered });
  else await writeProgress({ phase: 'error', read, discovered, lastError: outcome.message });
}

/** 저장된 진행 위치에서 4분 동안 색인을 돌린다. 끝나지 않으면 알람으로 30초 뒤에 이어 간다. */
async function runChunk(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const token = await readToken();
    if (!token) {
      await writeProgress({ ...(await readProgress()), phase: 'error', lastError: '토큰이 없습니다' });
      return;
    }
    stopRequested = false;
    const request = withRetry(createNotionClient(token), {
      onWait: (until) => void readProgress().then((progress) => writeProgress({ ...progress, waitingUntil: until })),
    });
    const outcome = await runCrawl(
      {
        request,
        store,
        now: Date.now,
        isStopped: () => stopRequested,
        onProgress: (read, discovered) => writeProgress({ phase: 'running', read, discovered }),
      },
      Date.now() + BUDGET_MS,
    );
    await finish(outcome);
  } finally {
    running = false;
  }
}

/** 처음이든 "다시 색인"이든 시작한다. 중단·오류로 멈춘 색인이 있으면 처음부터가 아니라 이어서 한다. */
async function startIndex(): Promise<void> {
  if (running) return;
  const [progress, state] = await Promise.all([readProgress(), store.getCrawl()]);
  const resumable = state !== undefined && state.phase !== 'done' && (progress.phase === 'paused' || progress.phase === 'error');
  if (!resumable) await beginCrawl(store, Date.now);
  await writeProgress({ ...(await store.counts()), phase: 'running' });
  void runChunk();
}

async function stopIndex(): Promise<void> {
  stopRequested = true;
  await chrome.alarms.clear(ALARM);
  if (!running) await writeProgress({ ...(await readProgress()), phase: 'paused' });
}

async function clearIndex(): Promise<void> {
  await stopIndex();
  while (running) await new Promise((resolve) => setTimeout(resolve, 100));
  await store.clear();
  await writeProgress(IDLE);
}

export async function handleIndexCommand(command: IndexCommand): Promise<void> {
  if (command === 'start') await startIndex();
  else if (command === 'stop') await stopIndex();
  else await clearIndex();
}

/** 붙여 넣은 토큰을 Notion에 한 번 물어 맞으면 저장한다(F-1). 토큰은 어떤 메시지·로그에도 넣지 않는다. */
export async function saveToken(token: string, kind: TokenKind): Promise<SaveTokenReply> {
  const trimmed = token.trim();
  if (trimmed === '') return { ok: false, message: '토큰을 입력해 주세요.' };
  try {
    const result = await checkToken(createNotionClient(trimmed));
    if (!result.ok) {
      const reason = result.status === 401 ? '토큰이 틀리거나 만료됐습니다.' : `Notion이 ${result.status} 오류를 돌려줬습니다.`;
      return { ok: false, message: reason };
    }
  } catch {
    return { ok: false, message: 'Notion에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.' };
  }
  await chrome.storage.local.set({ token: trimmed, tokenKind: kind });
  return { ok: true };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void runChunk();
});

// 서비스 워커가 다시 깨어났을 때 중단되지 않은 색인이 있으면 이어서 돈다
void readProgress().then((progress) => {
  if (progress.phase === 'running') void runChunk();
});
