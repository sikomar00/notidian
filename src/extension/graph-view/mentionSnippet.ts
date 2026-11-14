import type { LinkEvidence, LinkKind } from '../../graph/types.ts';
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

const KIND_TEXT: Record<LinkKind, string> = { mention: '@언급', link: '링크', linkToPage: '페이지로 연결 블록', relation: 'relation' };

/** 연결 근거 한 줄(F-28·F-29): "@언급 · 속성 "관련" · “…앞 <strong>찾은 글자</strong> 뒤…”". 근거를 모으기 전 연결이면 null. */
export function evidenceLine(evidence: LinkEvidence | undefined): HTMLSpanElement | null {
  if (!evidence) return null;
  const line = document.createElement('span');
  line.className = 'evidence';
  const { property, quoteProperty } = evidence;
  const kinds = evidence.kinds.map((kind) => KIND_TEXT[kind]).join(' · ');
  // 속성 이름은 문장이 나온 곳과 다를 때만 따로 적는다
  line.append(property === undefined || property === quoteProperty ? kinds : `${kinds} · 속성 "${property}"`);
  if (evidence.match === undefined) return line;
  // 문장이 어디서 나왔는지: 속성이면 그 이름, 다른 속성 이름이 앞에 있으면 "본문"
  const from = quoteProperty !== undefined ? ` · 속성 "${quoteProperty}"` : property !== undefined ? ' · 본문' : '';
  line.append(`${from} `, mentionSnippet({ id: '', title: '', count: 1, before: evidence.before ?? '', match: evidence.match, after: evidence.after ?? '' }));
  return line;
}
