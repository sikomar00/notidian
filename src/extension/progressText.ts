import type { Progress } from './background/types.ts';

/** 지난 시각을 "방금·N분 전·N시간 전·N일 전"으로 말한다. */
export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
}

/** "N분 전 갱신"이 낡지 않게 1분마다 다시 쓴다. 완성 시각이 보일 때만 바꾼다. */
export function keepTimeFresh(element: HTMLElement, current: () => Progress): void {
  setInterval(() => {
    const progress = current();
    if (progress.phase === 'done' && progress.finishedAt !== undefined) element.textContent = describeProgress(progress);
  }, 60_000);
}

/** 색인 진행 상태를 한 줄 글로 바꾼다(설정 화면과 그래프 상단 상태 줄에서 함께 쓴다). 화면에서는 색인을 "연결 지도"라고 부른다. */
export function describeProgress(progress: Progress, now: number = Date.now()): string {
  const counts = `${progress.read} / ${progress.discovered}개 페이지 읽음`;
  switch (progress.phase) {
    case 'idle':
      return '아직 연결 지도를 만들지 않았어요.';
    case 'running': {
      const waiting = progress.waitingUntil !== undefined && progress.waitingUntil > now;
      const firstText = progress.collectingText ? ' · 본문을 처음 모으느라 이번엔 전체를 다시 읽어요' : '';
      return `연결 지도를 만드는 중이에요 · ${counts}${firstText}${waiting ? ' (Notion이 잠시 쉬게 해서 기다리는 중이에요)' : ''}`;
    }
    case 'paused':
      return `멈췄어요 · ${counts}${progress.lastError ? ` (${progress.lastError})` : ''}`;
    case 'done':
      return `연결 지도 완성 · 페이지 ${progress.discovered}개${progress.finishedAt === undefined ? '' : ` · ${timeAgo(progress.finishedAt, now)} 갱신`}`;
    case 'error':
      return `문제가 생겼어요: ${progress.lastError ?? '알 수 없는 오류'} · ${counts}`;
  }
}
