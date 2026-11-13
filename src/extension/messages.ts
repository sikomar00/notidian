import type { NotionRequest } from '../notion/http.ts';

export type ViewMode = 'side' | 'center' | 'full';
export type TokenKind = 'internal' | 'pat';
export type IndexCommand = 'start' | 'stop' | 'clear';

export type Message =
  | { type: 'notion-request'; req: NotionRequest }
  | { type: 'save-token'; token: string; kind: TokenKind }
  | { type: 'index'; command: IndexCommand }
  | { type: 'toggle-overlay' }
  | { type: 'close-overlay' };

export type SaveTokenReply = { ok: true } | { ok: false; message: string };

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'side' || value === 'center' || value === 'full';
}
