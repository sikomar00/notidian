import type { KindFilter } from '../../graph/filter.ts';
import { byId } from '../dom.ts';
import type { ViewMode } from '../messages.ts';
import { switchMode } from './navigate.ts';
import { setupRadioGroup } from './radioGroup.ts';
import type { GraphView } from './render.ts';

/** 그래프 자리에 보이는 것: 그래프, 목록 보기, 언급 정리(S2-8) 중 하나 */
export type Shown = 'graph' | 'list' | 'cleanup';

const ZOOM_STEP = 1.5;
const VIEWS: readonly Shown[] = ['graph', 'list', 'cleanup'];

interface ToolbarDeps {
  mode: ViewMode;
  notice: HTMLElement;
  /** 그래프 캔버스를 담은 칸(직접 확대·이동하면 자동 맞춤을 멈춘다) */
  container: HTMLElement;
  view: () => GraphView | undefined;
  setAutoFit: (on: boolean) => void;
  /** 범례 칩을 눌러 그 종류를 숨기거나 보인다. 바뀐 뒤 보이는지(칩이 눌린 상태인지)를 돌려준다. 다시 그리지는 않는다 */
  toggleKind: (kind: keyof KindFilter) => boolean;
  /** 범례가 바뀌어 다시 그린다 */
  rebuild: () => void;
  showView: (next: Shown) => void;
}

/**
 * 도구줄 버튼을 잇는다: 보기 방식(옆 패널·가운데 창·전체 화면), 범례 칩, [그래프|목록|언급 정리], 확대·축소·맞춤, 설정 열기.
 * 돌려주는 함수는 보기 전환 묶음에서 고른 칸을 표시한다(코드에서 보기를 바꿀 때).
 */
export function setupToolbar({ mode, notice, container, view, setAutoFit, toggleKind, rebuild, showView }: ToolbarDeps): (shown: Shown) => void {
  for (const target of ['side', 'center', 'full'] as const) {
    const button = byId<HTMLButtonElement>(`mode-${target}`);
    button.setAttribute('aria-pressed', String(target === mode));
    button.addEventListener('click', () => {
      void switchMode(target, mode).then((failure) => {
        notice.textContent = failure ?? '';
      });
    });
  }

  for (const kind of ['page', 'dbItem', 'unreadable'] as const) {
    const button = byId<HTMLButtonElement>(kind === 'dbItem' ? 'legend-db' : `legend-${kind}`);
    // 눌린 상태를 먼저 고친다(다시 그리다 실패해도 칩과 숨김 상태가 어긋나지 않게)
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(toggleKind(kind)));
      rebuild();
    });
  }

  // 목록은 그래프를 못 보거나 키보드로 쓰는 사람을 위한 같은 내용의 다른 보기다. 셋 중 하나만 고르는 라디오 묶음
  const markView = setupRadioGroup(['view-graph', 'view-list', 'view-cleanup'].map((id) => byId<HTMLButtonElement>(id)), (index) => showView(VIEWS[index] ?? 'graph'));

  byId('zoom-in').addEventListener('click', () => {
    setAutoFit(false);
    view()?.zoomBy(ZOOM_STEP);
  });
  byId('zoom-out').addEventListener('click', () => {
    setAutoFit(false);
    view()?.zoomBy(1 / ZOOM_STEP);
  });
  byId('zoom-fit').addEventListener('click', () => {
    setAutoFit(true);
    view()?.fit();
  });
  for (const type of ['wheel', 'mousedown'] as const) {
    container.addEventListener(type, () => setAutoFit(false), { passive: true });
  }
  for (const id of ['open-settings', 'empty-settings']) byId(id).addEventListener('click', () => void chrome.runtime.openOptionsPage());

  return (shown) => markView(VIEWS.indexOf(shown));
}
