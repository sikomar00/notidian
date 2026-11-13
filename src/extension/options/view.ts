import type { PageRecord, UnreadableReason } from '../../graph/types.ts';

const REASON_TEXT: Record<UnreadableReason, string> = {
  forbidden: '권한 없음',
  'not-found': '삭제됐거나 접근할 수 없음',
  'not-a-page': '페이지가 아님',
  error: '여러 번 시도했지만 읽지 못함',
};

const MAX_LISTED = 50;

/** 읽지 못한 페이지의 개수와 목록(S1-5). 데이터베이스 같은 페이지가 아닌 대상은 개수만 알린다. */
export function renderUnreadable(list: HTMLElement, summary: HTMLElement, pages: readonly PageRecord[]): void {
  const unreadable = pages.filter((page) => page.status === 'unreadable' && page.unreadableReason !== 'not-a-page');
  const notPages = pages.filter((page) => page.unreadableReason === 'not-a-page').length;
  const lead = unreadable.length === 0 ? '읽지 못한 페이지가 없습니다.' : `읽지 못한 페이지 ${unreadable.length}개`;
  const tail = notPages > 0 ? ` 페이지가 아닌 대상(데이터베이스 등) ${notPages}개는 그래프에서 제외됩니다.` : '';
  summary.textContent = `${lead}${tail}`;
  list.replaceChildren(
    ...unreadable.slice(0, MAX_LISTED).map((page) => {
      const item = document.createElement('li');
      item.textContent = `${page.title || page.id.slice(-8)} — ${REASON_TEXT[page.unreadableReason ?? 'error']}`;
      return item;
    }),
  );
}
