import type { Progress } from './background/types.ts';

/** 색인 진행 상태를 한 줄 글로 바꾼다(설정 화면과 그래프 상단 상태 줄에서 함께 쓴다). 화면에서는 색인을 "연결 지도"라고 부른다. */
export function describeProgress(progress: Progress, now: number = Date.now()): string {
  const counts = `${progress.read} / ${progress.discovered}개 페이지 읽음`;
  switch (progress.phase) {
    case 'idle':
      return '아직 연결 지도를 만들지 않았어요.';
    case 'running': {
      const waiting = progress.waitingUntil !== undefined && progress.waitingUntil > now;
      return `연결 지도를 만드는 중이에요 · ${counts}${waiting ? ' (Notion이 잠시 쉬게 해서 기다리는 중이에요)' : ''}`;
    }
    case 'paused':
      return `멈췄어요 · ${counts}${progress.lastError ? ` (${progress.lastError})` : ''}`;
    case 'done':
      return `연결 지도 완성 · 페이지 ${progress.discovered}개`;
    case 'error':
      return `문제가 생겼어요: ${progress.lastError ?? '알 수 없는 오류'} · ${counts}`;
  }
}
