import { isRecord } from './json.ts';
import type { Json } from './json.ts';
import { normalizeId, urlToPageId } from './urlToPageId.ts';

function addId(out: Set<string>, id: string | null): void {
  if (id) out.add(id);
}

const pageOfUrl = (url: unknown): string | null => (typeof url === 'string' ? urlToPageId(url) : null);

/**
 * 리치텍스트 한 조각(@언급, 텍스트 링크, 링크 멘션)이 가리키는 페이지와 그 종류. 연결 근거(linkEvidence.ts)와 함께 쓴다.
 * @언급 조각에는 같은 페이지 주소(href)도 붙어 있어서, 먼저 찾은 종류(@언급)를 남긴다.
 */
export function richTextTargets(item: Json): { id: string; kind: 'mention' | 'link' }[] {
  const found = new Map<string, 'mention' | 'link'>();
  const add = (id: string | null, kind: 'mention' | 'link'): void => {
    if (id && !found.has(id)) found.set(id, kind);
  };
  const mention = item.mention;
  if (item.type === 'mention' && isRecord(mention)) {
    const page = mention.page;
    if (mention.type === 'page' && isRecord(page) && typeof page.id === 'string') add(normalizeId(page.id), 'mention');
    const linkMention = mention.link_mention;
    if (mention.type === 'link_mention' && isRecord(linkMention)) add(pageOfUrl(linkMention.href), 'link');
  }
  const link = isRecord(item.text) ? item.text.link : undefined;
  if (isRecord(link)) add(pageOfUrl(link.url), 'link');
  add(pageOfUrl(item.href), 'link');
  return [...found].map(([id, kind]) => ({ id, kind }));
}

// 리치텍스트 한 조각에서 대상 페이지 ID를 모은다
function collectFromRichTextItem(item: Json, out: Set<string>): void {
  for (const target of richTextTargets(item)) addId(out, target.id);
}

// 캡션·표 칸·토글 제목 등 어디에 묻혀 있어도 찾도록 값 전체를 훑는다
function collectFromValue(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectFromValue(entry, out);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.plain_text === 'string') collectFromRichTextItem(value, out);
  for (const entry of Object.values(value)) collectFromValue(entry, out);
}

/** 블록 하나의 연결 대상. `child_page`·`child_database`는 계층일 뿐 연결이 아니라서 무시한다. */
export function extractFromBlock(block: unknown): string[] {
  if (!isRecord(block) || typeof block.type !== 'string') return [];
  if (block.type === 'child_page' || block.type === 'child_database') return [];
  const out = new Set<string>();
  const payload = block[block.type];
  if (block.type === 'link_to_page') {
    if (isRecord(payload) && payload.type === 'page_id' && typeof payload.page_id === 'string') {
      addId(out, normalizeId(payload.page_id));
    }
  } else {
    collectFromValue(payload, out);
  }
  return [...out];
}

/** 페이지 속성의 연결 대상: relation 항목과 제목·텍스트 속성 안의 @언급. relation 25개 초과분은 호출하는 쪽이 따로 읽는다. */
export function extractFromProperties(properties: unknown): string[] {
  if (!isRecord(properties)) return [];
  const out = new Set<string>();
  for (const prop of Object.values(properties)) {
    if (!isRecord(prop)) continue;
    if (prop.type === 'relation' && Array.isArray(prop.relation)) {
      for (const ref of prop.relation) {
        if (isRecord(ref) && typeof ref.id === 'string') addId(out, normalizeId(ref.id));
      }
    } else if (prop.type === 'title' || prop.type === 'rich_text') {
      collectFromValue(prop[prop.type], out);
    }
  }
  return [...out];
}
