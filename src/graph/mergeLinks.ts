import type { MergedLink, RawLink } from './types.ts';

/** 자기 자신을 가리키는 연결은 버리고, 같은 쌍은 선 하나로 합친다. A→B와 B→A가 둘 다 있으면 양쪽 화살표. */
export function mergeLinks(rawLinks: readonly RawLink[]): MergedLink[] {
  const byPair = new Map<string, MergedLink>();
  for (const { from, to } of rawLinks) {
    if (from === to) continue;
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    const found = byPair.get(key);
    if (!found) byPair.set(key, { source: from, target: to, bidirectional: false });
    else if (found.source === to) found.bidirectional = true;
  }
  return [...byPair.values()];
}
