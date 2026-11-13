import { createAnnouncer } from '../announce.ts';
import { IDLE_PROGRESS } from '../background/types.ts';
import type { Progress, ProgressPhase } from '../background/types.ts';
import { byId } from '../dom.ts';
import type { Message } from '../messages.ts';
import { describeProgress, keepTimeFresh } from '../progressText.ts';

const REINDEX_LABEL: Record<ProgressPhase, string> = {
  idle: '연결 지도 만들기',
  running: '만드는 중…',
  paused: '이어서 만들기',
  error: '이어서 만들기',
  done: '다시 만들기',
};

/** 그래프 위쪽 상태 줄: 연결 지도 진행 문구, "다시 만들기" 버튼, 화면 읽기 프로그램 알림. */
export function createStatusLine(): { setProgress(progress: Progress): void; setHasToken(present: boolean): void } {
  const button = byId<HTMLButtonElement>('reindex');
  const hint = byId('reindex-hint');
  const status = byId('status');
  const announce = createAnnouncer(byId('progress-live'));
  let progress: Progress = IDLE_PROGRESS;
  let hasToken = false;

  // 토큰이 없으면 눌러도 오류만 나므로 끄고 이유를 보여 준다
  function renderButton(): void {
    button.textContent = REINDEX_LABEL[progress.phase];
    button.disabled = progress.phase === 'running' || !hasToken;
    hint.hidden = hasToken;
  }

  button.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'index', command: 'start' } satisfies Message);
  });
  keepTimeFresh(status, () => progress);

  return {
    setProgress(next) {
      progress = next;
      status.textContent = describeProgress(next);
      announce(next);
      renderButton();
    },
    setHasToken(present) {
      hasToken = present;
      renderButton();
    },
  };
}
