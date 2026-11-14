import { nearestSegment } from './hitTest.ts';
import type { Segment } from './hitTest.ts';

// 선을 찾는 화면 거리(px). 점도 적어도 이만큼은 잡아서, 축소한 화면에서도 점 옆이면 점이 먼저다(F-33)
export const LINK_REACH = 5;
const RECHECK_MS = 150;

export interface HoverDeps<L> {
  toGraph: (x: number, y: number) => { x: number; y: number };
  zoom: () => number;
  /** 그래프 좌표에서 `margin`(그래프 단위) 안에 있는 가장 가까운 점 ID. 없으면 null */
  nodeAt: (x: number, y: number, margin: number) => string | null;
  /** 지금 그린 선들의 양 끝(그래프 좌표) */
  segments: () => Iterable<Segment<L>>;
  onNode: (id: string | null) => void;
  /** 선에 올렸을 때(점 위·빈 곳·밖·끄는 중이면 null). 위치는 그래프 영역 안의 화면 좌표 */
  onLink: (link: L | null, point: { x: number; y: number }) => void;
  /** 한 프레임 뒤에 부른다(시험에서는 바로 부르게 바꾼다) */
  nextFrame?: (callback: () => void) => void;
}

interface PointerLike {
  clientX: number;
  clientY: number;
  buttons: number;
}

/**
 * force-graph의 호버 이벤트는 마우스가 그래프 밖으로 나갈 때 해제를 알리지 않고, 같은 점으로 돌아오면 다시 알리지도 않는다.
 * 그래서 호버는 공개 좌표 변환으로 직접 판정한다. 마우스 움직임은 한 프레임에 한 번만 처리한다(선 수천 개를 훑으므로, NF-16).
 * `recheck`는 마우스가 가만히 있어도 화면이 움직였을 때(확대·배치) 마지막 위치로 다시 판정한다.
 */
export function setupHover<L>(container: Pick<HTMLElement, 'addEventListener' | 'getBoundingClientRect'>, deps: HoverDeps<L>): { recheck(): void } {
  const nextFrame = deps.nextFrame ?? ((callback: () => void) => void requestAnimationFrame(callback));
  let pending: PointerLike | null = null;
  let last: PointerLike | null = null;

  function update(event: PointerLike): void {
    const box = container.getBoundingClientRect();
    const screen = { x: event.clientX - box.left, y: event.clientY - box.top };
    // 끌어서 옮기는 중에는 선을 찾지 않는다(지나가는 선마다 말풍선이 깜빡이지 않게)
    if (event.buttons !== 0) {
      deps.onLink(null, screen);
      return;
    }
    const point = deps.toGraph(screen.x, screen.y);
    const reach = LINK_REACH / deps.zoom();
    const node = deps.nodeAt(point.x, point.y, reach);
    deps.onNode(node);
    deps.onLink(node === null ? (nearestSegment(deps.segments(), point, reach) ?? null) : null, screen);
  }

  container.addEventListener('mousemove', (event) => {
    const scheduled = pending !== null;
    pending = event;
    last = event;
    if (scheduled) return;
    nextFrame(() => {
      const latest = pending;
      pending = null;
      if (latest) update(latest);
    });
  });
  container.addEventListener('mouseleave', () => {
    pending = null;
    last = null;
    deps.onNode(null);
    deps.onLink(null, { x: 0, y: 0 });
  });
  // 화면이 움직이는 동안 프레임마다 다시 판정하면 선 수천 개를 매번 훑으므로 이 간격으로만 한다
  let lastRecheck = 0;
  return {
    recheck() {
      const now = performance.now();
      if (!last || pending !== null || now - lastRecheck < RECHECK_MS) return;
      lastRecheck = now;
      update(last);
    },
  };
}
