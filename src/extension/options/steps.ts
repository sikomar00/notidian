import type { ProgressPhase } from '../background/types.ts';

export type StepState = 'done' | 'active' | 'todo';

export interface StepView {
  label: string;
  state: StepState;
}

/** 설정 화면 맨 위의 진행 단계(첫 실행 안내). "지금 할 차례"는 항상 하나뿐이다. 색만으로 구분하지 않도록 화면에는 상태 글자도 함께 쓴다. */
export function computeSteps(hasToken: boolean, phase: ProgressPhase): StepView[] {
  const made = hasToken && phase === 'done';
  return [
    { label: '토큰 저장', state: hasToken ? 'done' : 'active' },
    { label: '연결 지도 만들기', state: !hasToken ? 'todo' : made ? 'done' : 'active' },
    { label: '그래프 열기', state: made ? 'active' : 'todo' },
  ];
}

export const STEP_STATE_TEXT: Record<StepState, string> = {
  done: '완료',
  active: '지금 할 차례',
  todo: '아직',
};
