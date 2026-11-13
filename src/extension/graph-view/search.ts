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

const MAX_RESULTS = 8;

/** 제목 검색창(ARIA combobox). 방향키로 고르고 Enter로 이동한다 — 캔버스를 못 쓰는 키보드 사용자의 점 선택 수단이다. */
export function setupSearch(el: SearchElements, onPick: (id: string) => void): { setItems(items: readonly SearchItem[]): void } {
  let items: readonly SearchItem[] = [];
  let results: SearchItem[] = [];
  let active = -1;

  function close(): void {
    el.list.hidden = true;
    el.input.setAttribute('aria-expanded', 'false');
    el.input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function pick(item: SearchItem): void {
    el.input.value = item.title;
    close();
    onPick(item.id);
  }

  function render(): void {
    el.list.replaceChildren(
      ...results.map((item, index) => {
        const option = document.createElement('li');
        option.id = `search-option-${index}`;
        option.role = 'option';
        option.textContent = item.title;
        option.setAttribute('aria-selected', String(index === active));
        option.addEventListener('mousedown', (event) => {
          event.preventDefault();
          pick(item);
        });
        return option;
      }),
    );
    el.list.hidden = results.length === 0;
    el.input.setAttribute('aria-expanded', String(results.length > 0));
    if (active >= 0) el.input.setAttribute('aria-activedescendant', `search-option-${active}`);
    else el.input.removeAttribute('aria-activedescendant');
  }

  el.input.addEventListener('input', () => {
    results = searchTitles(items, el.input.value, MAX_RESULTS);
    active = results.length > 0 ? 0 : -1;
    render();
    el.live.textContent = el.input.value.trim() === '' ? '' : `${results.length}개 찾음`;
  });

  el.input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + results.length) % results.length;
      render();
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      const chosen = results[active];
      if (chosen) pick(chosen);
    } else if (event.key === 'Escape' && !el.list.hidden) {
      event.stopPropagation();
      close();
    }
  });

  el.input.addEventListener('blur', close);

  return {
    setItems(next) {
      items = next;
    },
  };
}
