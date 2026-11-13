import type { Progress } from './background/types.ts';

/** 설정 화면에서 고를 수 있는 자동 다시 만들기 주기(분). 0은 끔. */
export const AUTO_REFRESH_CHOICES = [0, 30, 60, 1440] as const;
// 알람이 정확한 시각보다 조금 일찍 울릴 수 있어서 둔 여유
const EARLY_MS = 60_000;

/** 저장된 값을 고를 수 있는 주기로 맞춘다. 모르는 값이면 끔. */
export function autoRefreshMinutes(stored: unknown): number {
  return AUTO_REFRESH_CHOICES.find((choice) => choice === stored) ?? 0;
}

/**
 * 자동으로 다시 만들지. 토큰이 있어야 하고,
 * - 완성된 지도는 마지막 완성 뒤 주기만큼 지났을 때만(직접 다시 만든 직후 또 읽지 않게)
 * - 자동 실행이 호출 제한·오류로 멈췄으면 다음 주기에 이어서(한 번 실패로 자동 갱신이 꺼지지 않게)
 * - 사용자가 직접 멈췄거나 직접 시작한 실행이 오류로 멈췄으면, 또 처음·만드는 중이면 건너뛴다.
 */
export function shouldAutoRefresh(progress: Progress, hasToken: boolean, minutes: number, now: number): boolean {
  if (!hasToken || minutes === 0) return false;
  if (progress.phase === 'done') return progress.finishedAt === undefined || now - progress.finishedAt >= minutes * 60_000 - EARLY_MS;
  return (progress.phase === 'paused' || progress.phase === 'error') && progress.auto === true;
}
