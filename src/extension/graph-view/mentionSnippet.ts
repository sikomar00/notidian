import type { Mention } from '../../graph/unlinkedMentions.ts';

// 서랍 칸과 언급 정리가 같은 모양으로 그리도록 한곳에 둔다

/** 페이지 제목(밑줄은 CSS가 붙인다). */
export function mentionName(title: string): HTMLSpanElement {
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = title;
  return name;
}

/** “앞 글자 <strong>찾은 글자</strong> 뒤 글자”. 찾은 글자는 색이 아니라 굵기로 표시한다. */
export function mentionSnippet(mention: Mention): HTMLSpanElement {
  const snippet = document.createElement('span');
  snippet.className = 'snippet';
  const match = document.createElement('strong');
  match.textContent = mention.match;
  snippet.append(`“${mention.before}`, match, `${mention.after}”`);
  return snippet;
}
