import { MAX_PATH_STEPS, shortestPath } from '../../graph/path.ts';
import type { GraphData, LinkEvidence } from '../../graph/types.ts';
import { byId } from '../dom.ts';
import { evidenceLine } from './mentionSnippet.ts';
import { setupSearch } from './search.ts';
import type { SearchItem } from './search.ts';

interface PathDeps {
  /** 범례·보기 옵션을 반영한 지금의 그래프(받은·보낸 연결과 같은 기준) */
  graph: () => GraphData;
  titleOf: (id: string) => string;
  /** `from → to` 방향 연결이 있는지 */
  hasLink: (from: string, to: string) => boolean;
  /** `from → to` 연결의 근거. 근거를 모으기 전 연결이면 undefined */
  evidenceOf: (from: string, to: string) => LinkEvidence | undefined;
  /** 그 점이 지금 그래프에 그려져 있는지(주변만 보기에서는 일부만 그린다) */
  drawn: (id: string) => boolean;
  /** 그래프에서 길을 강조한다(null이면 지운다) */
  onPath: (ids: string[] | null) => void;
}

// 길 위의 한 단계: 앞 페이지와 이 페이지를 잇는 연결의 방향과 근거, 그리고 이 페이지 이름
function stepItem(deps: PathDeps, previous: string | undefined, id: string): HTMLLIElement {
  const li = document.createElement('li');
  if (previous !== undefined) {
    // 방향은 근거가 아니라 실제 연결로 정한다(근거를 모으기 전 연결도 있다). 양쪽이면 앞 → 뒤로 읽는다
    const forward = deps.hasLink(previous, id);
    const hop = document.createElement('span');
    hop.className = 'hop';
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = forward ? '↓ ' : '↑ ';
    const direction = document.createElement('span');
    direction.className = 'sr-only';
    direction.textContent = forward ? '앞 페이지가 가리킴: ' : '이 페이지가 앞 페이지를 가리킴: ';
    hop.append(arrow, direction, evidenceLine(forward ? deps.evidenceOf(previous, id) : deps.evidenceOf(id, previous)) ?? '연결');
    li.append(hop);
  }
  const name = document.createElement('strong');
  name.textContent = deps.titleOf(id);
  li.append(name);
  return li;
}


/** 고른 페이지에서 다른 페이지까지 가장 짧은 길(F-31·F-32). 검색칸은 제목 검색과 같은 방식이다. */
export function createPathPanel(deps: PathDeps): { setItems(items: readonly SearchItem[]): void; setSource(id: string | null): void; refresh(): void } {
  const input = byId<HTMLInputElement>('path-search');
  const note = byId('path-note');
  const result = byId('path-result');
  const clear = byId<HTMLButtonElement>('path-clear');
  let source: string | null = null;
  let target: string | null = null;

  function reset(): void {
    target = null;
    input.value = '';
    note.textContent = '';
    result.replaceChildren();
    clear.hidden = true;
    deps.onPath(null);
  }

  // 지금 그래프로 길을 다시 구한다(범례·보기 옵션이 바뀌거나 지도를 다시 읽었을 때도 부른다)
  function show(): void {
    if (source === null || target === null) return;
    const path = shortestPath(deps.graph(), { from: source, to: target });
    clear.hidden = false;
    if (!path) {
      note.textContent = `${MAX_PATH_STEPS}단계 안에 이어지는 길이 없어요`;
      result.replaceChildren();
      deps.onPath(null);
      return;
    }
    const steps = path.length === 1 ? '같은 페이지예요' : `${path.length - 1}단계로 이어져요`;
    // 주변만 보기면 길 일부가 그래프에 안 그려질 수 있어 알린다
    note.textContent = path.every(deps.drawn) ? steps : `${steps}. 주변만 보는 중이라 길 일부는 그래프에 안 보여요`;
    result.replaceChildren(...path.map((id, index) => stepItem(deps, path[index - 1], id)));
    deps.onPath(path);
  }

  const search = setupSearch({ input, list: byId<HTMLUListElement>('path-list'), live: byId('live') }, (picked) => {
    target = picked;
    show();
  });
  clear.addEventListener('click', () => {
    reset();
    input.focus();
  });

  return {
    setItems: search.setItems,
    setSource(id) {
      if (id === source) return;
      source = id;
      reset();
    },
    refresh: show,
  };
}
