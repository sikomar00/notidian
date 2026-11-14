/** 화면에 그린 선 하나(그래프 좌표의 양 끝). */
export interface Segment<T> {
  item: T;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 점 (px, py)에서 선분까지의 가장 짧은 거리. */
export function distanceToSegment(px: number, py: number, { x1, y1, x2, y2 }: Omit<Segment<unknown>, 'item'>): number {
  const [dx, dy] = [x2 - x1, y2 - y1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** `reach` 안에서 (px, py)에 가장 가까운 선. 없으면 undefined. 선 수만큼 한 번 훑는다(2,000점·선 5,000개도 1ms 안팎). */
export function nearestSegment<T>(segments: Iterable<Segment<T>>, point: { x: number; y: number }, reach: number): T | undefined {
  let best: T | undefined;
  let bestDistance = reach;
  for (const segment of segments) {
    const distance = distanceToSegment(point.x, point.y, segment);
    if (distance <= bestDistance) {
      best = segment.item;
      bestDistance = distance;
    }
  }
  return best;
}
