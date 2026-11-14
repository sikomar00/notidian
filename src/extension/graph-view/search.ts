import { searchTitles } from '../../graph/searchTitles.ts';

export interface SearchItem {
  id: string;
  title: string;
}

interface SearchElements {
  input: HTMLInputElement;
  list: HTMLUListElement;
  live: HTMLElement;
}

interface SearchState {
  items: readonly SearchItem[];
  results: SearchItem[];
  active: number;
}

const MAX_RESULTS = 8;

function closeList(el: SearchElements, state: SearchState): void {
  el.list.hidden = true;
  el.input.setAttribute('aria-expanded', 'false');
  el.input.removeAttribute('aria-activedescendant');
  state.active = -1;
}

function renderOptions(el: SearchElements, state: SearchState, pick: (item: SearchItem) => void): void {
  el.list.replaceChildren(
    ...state.results.map((item, index) => {
      const option = document.createElement('li');
      // 검색칸이 둘(제목 검색·경로 찾기)이라 후보 ID에 목록 ID를 붙여 겹치지 않게 한다
      option.id = `${el.list.id}-option-${index}`;
      option.role = 'option';
      option.textContent = item.title;
      option.setAttribute('aria-selected', String(index === state.active));
      option.addEventListener('mousedown', (event) => {
        event.preventDefault();
        pick(item);
      });
      return option;
    }),
  );
  el.list.hidden = state.results.length === 0;
  el.input.setAttribute('aria-expanded', String(state.results.length > 0));
  if (state.active >= 0) el.input.setAttribute('aria-activedescendant', `${el.list.id}-option-${state.active}`);
  else el.input.removeAttribute('aria-activedescendant');
}

function handleKey(
  event: KeyboardEvent,
  el: SearchElements,
  state: SearchState,
  pick: (item: SearchItem) => void,
  render: () => void,
): void {
  // 한글 같은 조합 입력에서 글자를 확정하는 Enter·방향키는 검색창 동작으로 쓰지 않는다
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (state.results.length === 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    state.active = (state.active + step + state.results.length) % state.results.length;
    render();
  } else if (event.key === 'Enter' && state.active >= 0) {
    event.preventDefault();
    const chosen = state.results[state.active];
    if (chosen) pick(chosen);
  } else if (event.key === 'Escape' && !el.list.hidden) {
    event.stopPropagation();
    closeList(el, state);
  }
}

/** 제목 검색창(ARIA combobox). 방향키로 고르고 Enter로 이동한다 — 캔버스를 못 쓰는 키보드 사용자의 점 선택 수단이다. */
export function setupSearch(el: SearchElements, onPick: (id: string) => void): { setItems(items: readonly SearchItem[]): void } {
  const state: SearchState = { items: [], results: [], active: -1 };
  const pick = (item: SearchItem): void => {
    el.input.value = item.title;
    closeList(el, state);
    onPick(item.id);
  };
  const render = (): void => renderOptions(el, state, pick);

  el.input.addEventListener('input', () => {
    state.results = searchTitles(state.items, el.input.value, MAX_RESULTS);
    state.active = state.results.length > 0 ? 0 : -1;
    render();
    el.live.textContent = el.input.value.trim() === '' ? '' : `${state.results.length}개 찾음`;
  });
  el.input.addEventListener('keydown', (event) => handleKey(event, el, state, pick, render));
  el.input.addEventListener('blur', () => closeList(el, state));

  return {
    setItems(next) {
      state.items = next;
    },
  };
}
