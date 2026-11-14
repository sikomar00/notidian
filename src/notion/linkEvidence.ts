import type { LinkEvidence, LinkKind } from '../graph/types.ts';
import { contextAt } from '../graph/unlinkedMentions.ts';
import { richTextTargets } from './extractLinks.ts';
import { isRecord } from './json.ts';
import { normalizeId } from './urlToPageId.ts';

/** 대상 페이지 ID → 그 연결의 근거(F-28·F-29). */
export type EvidenceMap = Map<string, LinkEvidence>;

type Found = Omit<LinkEvidence, 'kinds'> & { kind: LinkKind };

// 같은 대상이 여러 번 나오면 종류는 모두 모으고, 속성 이름과 앞뒤 글자는 처음 나온 것을 남긴다.
// 앞뒤 글자를 남길 때 그 글자가 나온 속성(없으면 본문)도 함께 적어, 다른 곳의 속성 이름과 섞여 보이지 않게 한다
function note(map: EvidenceMap, id: string, { kind, ...extra }: Found): void {
  const known = map.get(id) ?? { kinds: [] };
  map.set(id, known);
  if (!known.kinds.includes(kind)) known.kinds.push(kind);
  if (known.property === undefined && extra.property !== undefined) known.property = extra.property;
  if (known.match !== undefined || extra.match === undefined) return;
  Object.assign(known, { before: extra.before, match: extra.match, after: extra.after });
  const from = extra.quoteProperty ?? extra.property;
  if (from !== undefined) known.quoteProperty = from;
}

const plainText = (item: unknown): string => (isRecord(item) && typeof item.plain_text === 'string' ? item.plain_text : '');
const isRichTextItem = (value: unknown): boolean => isRecord(value) && typeof value.plain_text === 'string';

// 리치텍스트 배열 하나를 한 줄로 이어 붙이고, 연결이 걸린 조각마다 그 자리의 앞뒤 글자를 근거로 남긴다
function fromRichText(items: readonly unknown[], map: EvidenceMap, property?: string): void {
  const texts = items.map(plainText);
  // 줄바꿈은 공백으로(글자 수는 그대로라 위치가 맞는다)
  const line = texts.join('').replace(/\n/g, ' ');
  let at = 0;
  items.forEach((item, index) => {
    const length = texts[index]?.length ?? 0;
    if (isRecord(item)) {
      for (const target of richTextTargets(item)) note(map, target.id, { kind: target.kind, ...(property ? { property } : {}), ...contextAt(line, at, length) });
    }
    at += length;
  });
}

// 캡션·표 칸·토글 제목 등 어디에 묻혀 있어도 찾도록 값 전체를 훑는다(extractLinks.ts와 같은 범위).
// 리치텍스트 배열은 한 줄로 근거를 뽑고, 그 안에 섞인 다른 값은 계속 훑는다
function walk(value: unknown, map: EvidenceMap): void {
  if (Array.isArray(value)) {
    if (value.some(isRichTextItem)) fromRichText(value.filter(isRichTextItem), map);
    for (const entry of value) if (!isRichTextItem(entry)) walk(entry, map);
    return;
  }
  if (!isRecord(value)) return;
  if (isRichTextItem(value)) {
    fromRichText([value], map);
    return;
  }
  for (const entry of Object.values(value)) walk(entry, map);
}

/** 본문 블록들에서 대상마다 근거. 하위 페이지·하위 DB는 계층이라 연결이 아니다. 근거가 있는 대상이 곧 본문의 연결 대상이다. */
export function evidenceFromBlocks(blocks: readonly unknown[]): EvidenceMap {
  const map: EvidenceMap = new Map();
  for (const block of blocks) {
    if (!isRecord(block) || typeof block.type !== 'string') continue;
    if (block.type === 'child_page' || block.type === 'child_database') continue;
    const payload = block[block.type];
    if (block.type === 'link_to_page') {
      const id = isRecord(payload) && payload.type === 'page_id' && typeof payload.page_id === 'string' ? normalizeId(payload.page_id) : null;
      if (id) note(map, id, { kind: 'linkToPage' });
    } else {
      walk(payload, map);
    }
  }
  return map;
}

/** 페이지 속성에서 대상마다 근거: relation(속성 이름)과 제목·텍스트 속성 속 @언급·링크(속성 이름과 앞뒤 글자). */
export function evidenceFromProperties(properties: unknown): EvidenceMap {
  const map: EvidenceMap = new Map();
  if (!isRecord(properties)) return map;
  for (const [name, prop] of Object.entries(properties)) {
    if (!isRecord(prop)) continue;
    if (prop.type === 'relation' && Array.isArray(prop.relation)) {
      for (const ref of prop.relation) {
        const id = isRecord(ref) && typeof ref.id === 'string' ? normalizeId(ref.id) : null;
        if (id) note(map, id, { kind: 'relation', property: name });
      }
    } else if ((prop.type === 'title' || prop.type === 'rich_text') && Array.isArray(prop[prop.type])) {
      fromRichText(prop[prop.type] as unknown[], map, name);
    }
  }
  return map;
}

/** 앞의 것을 먼저 두고 합친다(속성 → 본문 순서로 부른다). */
export function mergeEvidence(...maps: readonly EvidenceMap[]): EvidenceMap {
  const merged: EvidenceMap = new Map();
  for (const map of maps) {
    for (const [id, { kinds, ...extra }] of map) {
      for (const kind of kinds) note(merged, id, { kind, ...extra });
    }
  }
  return merged;
}
