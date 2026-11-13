import type { Progress, ProgressPhase } from './background/types.ts';
import { describeProgress } from './progressText.ts';

/** 단계가 바뀌었거나 마지막 알림에서 충분히 지났을 때만 스크린리더에 알린다. 읽을 때마다 알리면 계속 읽어 주게 된다. */
export function shouldAnnounce(previous: ProgressPhase | undefined, next: ProgressPhase, sinceLastMs: number, gapMs: number): boolean {
  return previous !== next || sinceLastMs >= gapMs;
}

export function createAnnouncer(liveRegion: HTMLElement, gapMs = 15_000, now: () => number = Date.now): (progress: Progress) => void {
  let previous: ProgressPhase | undefined;
  let lastAt = -Infinity;
  return (progress) => {
    // 사용자가 요청하지 않은 자동 다시 만들기는 알리지 않는다(30분마다 읽어 주면 방해가 된다)
    if (!progress.auto && shouldAnnounce(previous, progress.phase, now() - lastAt, gapMs)) {
      liveRegion.textContent = describeProgress(progress, now());
      lastAt = now();
    }
    previous = progress.phase;
  };
}
