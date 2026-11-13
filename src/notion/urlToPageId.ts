const NOTION_HOSTS = new Set(['app.notion.com', 'www.notion.so', 'notion.so']);
const HEX32_AT_END = /(?:^|[-/])([0-9a-f]{32})\/?$/i;
const UUID_AT_END = /(?:^|\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** 32자리 또는 하이픈 UUID를 소문자 8-4-4-4-12로 맞춘다. 형식이 아니면 null. */
export function normalizeId(raw: string): string | null {
  const hex = raw.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 지금 열린 탭이 Notion 웹앱(app.notion.com)인지. */
export function isNotionAppUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'app.notion.com';
  } catch {
    return false;
  }
}

/** Notion 페이지 주소에서 페이지 ID를 뽑는다. 다른 호스트·http·`?p=` 형태는 null(첫 버전에서 무시). */
export function urlToPageId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || !NOTION_HOSTS.has(parsed.hostname)) return null;
  const match = parsed.pathname.match(UUID_AT_END) ?? parsed.pathname.match(HEX32_AT_END);
  return match?.[1] ? normalizeId(match[1]) : null;
}

/** 이동할 페이지 주소. 저장된 주소가 Notion 주소가 아니거나 다른 페이지의 것이면 ID로 새로 만든다. */
export function pageUrl(id: string, stored?: string): string {
  if (stored && urlToPageId(stored) === id) return stored;
  return `https://app.notion.com/p/${id.replaceAll('-', '')}`;
}
