export type Json = Record<string, unknown>;

export function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Json {
  return isRecord(value) ? value : {};
}

/** Notion 목록 응답에서 다음 쪽 커서. 더 없으면 undefined. */
export function nextCursorOf(body: Json): string | undefined {
  return body.has_more === true && typeof body.next_cursor === 'string' ? body.next_cursor : undefined;
}

export function codeOf(body: unknown): string {
  const code = asRecord(body).code;
  return typeof code === 'string' ? code : 'unknown';
}
