import { neighborMap } from './neighbors.ts';
import type { GraphData } from './types.ts';

/** 경로 찾기에서 보는 최대 단계 수(F-31). 이보다 멀면 "이어지는 길이 없다"로 본다 */
export const MAX_PATH_STEPS = 6;

/**
 * 두 페이지 사이의 가장 짧은 길(점 ID 목록, 처음과 끝 포함). 방향은 무시하고 하위 페이지 선은 연결이 아니라 빼며,
 * `maxSteps`(기본 6) 단계 안에 없으면 null. 같은 페이지면 [그 페이지].
 */
export function shortestPath(data: GraphData, { from, to, maxSteps = MAX_PATH_STEPS }: { from: string; to: string; maxSteps?: number }): string[] | null {
  const neighbors = neighborMap(data.links.filter((link) => !link.hierarchy));
  const previous = new Map<string, string | null>([[from, null]]);
  let frontier = [from];
  for (let step = 0; step < maxSteps && !previous.has(to); step += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of neighbors.get(id) ?? []) {
        if (previous.has(other)) continue;
        previous.set(other, id);
        next.push(other);
      }
    }
    frontier = next;
  }
  if (!previous.has(to)) return null;
  const path: string[] = [];
  for (let id: string | null | undefined = to; id; id = previous.get(id)) path.unshift(id);
  return path;
}
