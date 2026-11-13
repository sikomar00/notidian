export type ViewMode = 'side' | 'center' | 'full';
export type TokenKind = 'internal' | 'pat';
export type IndexCommand = 'start' | 'stop' | 'clear';

export type Message =
  | { type: 'save-token'; token: string; kind: TokenKind }
  | { type: 'token-session'; sessionOnly: boolean }
  | { type: 'clear-token' }
  | { type: 'index'; command: IndexCommand }
  | { type: 'toggle-overlay' }
  | { type: 'close-overlay' };

/** 저장에 성공하면 읽을 수 있는 페이지 수를 함께 준다(확인에 실패하면 수가 없다). */
export type SaveTokenReply = { ok: true; pageCount?: number; more?: boolean } | { ok: false; message: string };

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'side' || value === 'center' || value === 'full';
}
