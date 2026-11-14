import { asRecord, isRecord } from './json.ts';

/** 글자를 모으는 규칙의 버전. 모으는 블록 종류를 바꾸면 올려서, 저장된 페이지들을 다음 다시 만들기에서 다시 읽게 한다. */
export const TEXT_VERSION = 1;
/** 한 페이지에서 저장하는 글자 수 한도(NF-9). 넘으면 앞부분만 남긴다 */
export const MAX_TEXT = 100_000;

const TEXT_BLOCKS = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item',
  'to_do', 'toggle', 'quote', 'callout',
]);

// @언급의 글자는 대상 페이지 제목이라 넣지 않는다("회의록 2024"를 언급한 곳이 "회의록"의 연결 안 된 언급으로 잡히지 않게)
function richText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((item) => (isRecord(item) && item.type !== 'mention' && typeof item.plain_text === 'string' ? item.plain_text : '')).join('');
}

/** 블록 하나의 글자. 코드 블록·하위 페이지 등 모으지 않는 종류는 빈 문자열. 줄바꿈은 공백으로 바꿔 블록 하나가 한 줄이 되게 한다. */
export function blockText(block: unknown): string {
  if (!isRecord(block) || typeof block.type !== 'string') return '';
  const payload = asRecord(block[block.type]);
  let text = '';
  if (TEXT_BLOCKS.has(block.type)) text = richText(payload.rich_text);
  else if (block.type === 'table_row' && Array.isArray(payload.cells)) text = payload.cells.map(richText).join(' ');
  return text.replace(/\s*\n\s*/g, ' ').trim();
}

/** 페이지 본문 글자: 블록마다 한 줄, 빈 블록은 뺀다. 한도를 넘으면 앞부분만. */
export function pageText(blocks: readonly unknown[]): string {
  const text = blocks.map(blockText).filter((line) => line !== '').join('\n').slice(0, MAX_TEXT);
  // 한도에서 이모지 같은 두 칸짜리 글자가 반으로 잘리면 앞 반쪽을 버린다
  return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
}
