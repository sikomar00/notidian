import type { Progress } from './background/types.ts';

/** 색인 진행 상태를 한 줄 글로 바꾼다(설정 화면과 그래프 상단 상태 줄에서 함께 쓴다). */
export function describeProgress(progress: Progress, now: number = Date.now()): string {
  const counts = `읽은 페이지 ${progress.read}개 / 발견한 페이지 ${progress.discovered}개`;
  switch (progress.phase) {
    case 'idle':
      return '아직 색인하지 않았습니다.';
    case 'running': {
      const waiting = progress.waitingUntil !== undefined && progress.waitingUntil > now;
      return `색인 중 — ${counts}${waiting ? ' (호출 제한으로 잠시 대기 중)' : ''}`;
    }
    case 'paused':
      return `중단됨 — ${counts}`;
    case 'done':
      return `색인 완료 — 페이지 ${progress.discovered}개`;
    case 'error':
      return `오류: ${progress.lastError ?? '알 수 없는 오류'} — ${counts}`;
  }
}
