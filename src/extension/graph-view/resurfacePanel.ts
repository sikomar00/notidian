import { pickUnseen, resurfaceCandidates } from '../../graph/resurface.ts';
import type { ResurfaceMode } from '../../graph/resurface.ts';
import type { NodeRow } from '../../graph/rows.ts';
import type { PageRecord } from '../../graph/types.ts';
import { byId } from '../dom.ts';

const EMPTY_TEXT: Record<ResurfaceMode, string> = {
  random: '꺼낼 페이지가 없어요',
  forgotten: '수정 시각을 아는 페이지가 없어요',
  lonely: '연결이 1개 이하인 페이지가 없어요',
};

/**
 * 다시 볼 페이지(F-38·F-39): 종류를 고르고 "다른 페이지"를 누르면, 아직 안 꺼낸 페이지 하나를 그래프에서 고른다.
 * 꺼낸 페이지는 화면을 연 동안만 기억한다(종류마다 따로).
 */
export function setupResurface(rows: () => readonly NodeRow[], pages: () => ReadonlyMap<string, PageRecord>, onPick: (id: string) => void): void {
  const mode = byId<HTMLSelectElement>('resurface-mode');
  const live = byId('live');
  const seen = new Map<ResurfaceMode, Set<string>>();
  byId('resurface').addEventListener('click', () => {
    const kind = mode.value as ResurfaceMode;
    let used = seen.get(kind);
    if (!used) {
      used = new Set();
      seen.set(kind, used);
    }
    const picked = pickUnseen(resurfaceCandidates(rows(), pages(), kind), used);
    if (picked === null) live.textContent = EMPTY_TEXT[kind];
    else onPick(picked);
  });
}
