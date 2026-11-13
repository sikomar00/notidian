import type { NodeRow } from '../../graph/rows.ts';
import { searchTitles } from '../../graph/searchTitles.ts';

const MAX_ROWS = 300;

function kindText(row: NodeRow): string {
  if (row.unreadable) return '읽을 수 없음';
  return row.kind === 'dbItem' ? 'DB 항목' : '페이지';
}

function cell(text: string, className = ''): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  td.className = className;
  return td;
}

function rowElement(row: NodeRow, onOpen: (id: string) => void): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.dataset.id = row.id;
  const name = document.createElement('th');
  name.scope = 'row';
  name.textContent = row.title;
  const action = document.createElement('td');
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = '열기';
  button.setAttribute('aria-label', `${row.title} Notion에서 열기`);
  button.addEventListener('click', () => onOpen(row.id));
  action.append(button);
  tr.append(name, cell(kindText(row)), cell(String(row.received), 'num'), cell(String(row.sent), 'num'), action);
  return tr;
}

/** 그래프의 글 대안(WCAG 1.1.1): 점을 표로 보여 주고 키보드로 바로 열 수 있게 한다. 연결이 많은 순, 제목 검색으로 좁힌다. */
export function createListView(
  body: HTMLTableSectionElement,
  note: HTMLElement,
  onOpen: (id: string) => void,
): { setRows(rows: readonly NodeRow[]): void; setQuery(query: string): void } {
  let rows: readonly NodeRow[] = [];
  let query = '';

  function render(): void {
    const searching = query.trim() !== '';
    const shown = searching ? searchTitles(rows, query, MAX_ROWS) : rows.slice(0, MAX_ROWS);
    // 색인 중 2초마다 다시 그려도 키보드 초점이 있던 "열기" 버튼에 초점을 되돌린다
    const focusedId = body.contains(document.activeElement) ? document.activeElement?.closest('tr')?.dataset.id : undefined;
    body.replaceChildren(...shown.map((row) => rowElement(row, onOpen)));
    if (focusedId !== undefined) body.querySelector<HTMLElement>(`tr[data-id="${CSS.escape(focusedId)}"] button`)?.focus();
    if (searching) note.textContent = `"${query.trim()}" 검색 결과 ${shown.length}개`;
    else if (rows.length > MAX_ROWS) note.textContent = `연결이 많은 순으로 ${MAX_ROWS}개까지 보여요(전체 ${rows.length}개). 제목 검색으로 좁혀 보세요.`;
    else note.textContent = `페이지 ${rows.length}개, 연결이 많은 순`;
  }

  return {
    setRows(next) {
      rows = next;
      render();
    },
    setQuery(next) {
      query = next;
      render();
    },
  };
}
