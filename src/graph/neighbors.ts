/** 점마다 연결된 이웃 점의 ID 모음(방향 무시). 호버 강조에 쓴다. */
export function neighborMap(links: readonly { source: string; target: string }[]): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();
  const add = (from: string, to: string): void => {
    const set = neighbors.get(from) ?? new Set<string>();
    set.add(to);
    neighbors.set(from, set);
  };
  for (const { source, target } of links) {
    add(source, target);
    add(target, source);
  }
  return neighbors;
}
