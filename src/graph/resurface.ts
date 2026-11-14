import type { NodeRow } from './rows.ts';
import type { PageRecord } from './types.ts';

/** 다시 볼 페이지 종류(F-38): 아무거나, 오래 안 고친 것, 연결이 거의 없는 것. */
export type ResurfaceMode = 'random' | 'forgotten' | 'lonely';

// 잊힌 페이지: 수정 시각이 오래된 쪽에서 이만큼(비율)
const FORGOTTEN_SHARE = 0.2;
// 외톨이: 받은·보낸 연결을 합해 이 수 이하
const LONELY_MAX = 1;

/**
 * 종류에 맞는 후보 페이지 ID(F-38). 지금 그래프에 보이는 읽을 수 있는 페이지(`rows`) 안에서 고른다.
 * 잊힌 페이지는 수정 시각이 오래된 20%(적어도 1개), 외톨이는 연결이 1개 이하.
 */
export function resurfaceCandidates(rows: readonly NodeRow[], pages: ReadonlyMap<string, PageRecord>, mode: ResurfaceMode): string[] {
  const readable = rows.filter((row) => !row.unreadable);
  if (mode === 'lonely') return readable.filter((row) => row.received + row.sent <= LONELY_MAX).map((row) => row.id);
  if (mode === 'random') return readable.map((row) => row.id);
  const dated = readable
    .map((row) => ({ id: row.id, at: Date.parse(pages.get(row.id)?.lastEdited ?? '') }))
    .filter((item) => Number.isFinite(item.at))
    .sort((a, b) => a.at - b.at);
  return dated.slice(0, Math.max(1, Math.ceil(dated.length * FORGOTTEN_SHARE))).map((item) => item.id);
}

/**
 * 후보 중 아직 꺼내지 않은 것을 하나 고른다(F-39). 다 꺼냈으면 처음부터 다시(`seen`을 비운다).
 * 후보가 없으면 null. `random`은 0 이상 1 미만(시험에서 고정한다).
 */
export function pickUnseen(candidates: readonly string[], seen: Set<string>, random: () => number = Math.random): string | null {
  if (candidates.length === 0) return null;
  let fresh = candidates.filter((id) => !seen.has(id));
  if (fresh.length === 0) {
    for (const id of candidates) seen.delete(id);
    fresh = [...candidates];
  }
  const picked = fresh[Math.floor(random() * fresh.length)] ?? fresh[0] ?? null;
  if (picked !== null) seen.add(picked);
  return picked;
}
