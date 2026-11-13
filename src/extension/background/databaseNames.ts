import type { PageRecord } from '../../graph/types.ts';
import { fetchDataSourceTitle } from '../../notion/endpoints.ts';
import type { Requester } from '../../notion/endpoints.ts';

// DB 이름을 읽을 권한이 없거나(403·404) 이름이 비어 있으면 이 이름으로 둔다
export const UNNAMED_DATABASE = '이름 없는 DB';
// 한 번에 묻는 DB 수. DB가 아주 많아도 지도 완성 뒤 요청이 끝없이 이어지지 않게 하고, 나머지는 다음 완성 때 묻는다
const PER_RUN = 20;

/** 색인에 나온 DB 중 아직 이름을 모르는 것들(처음 나온 순서). */
export function unknownDatabases(pages: readonly PageRecord[], known: Readonly<Record<string, string>>): string[] {
  return [...new Set(pages.flatMap((page) => (page.databaseId ? [page.databaseId] : [])))].filter((id) => !(id in known));
}

/**
 * 지도를 다 만든 뒤 처음 보는 DB의 이름을 Notion에 물어 저장한다(DB별 색의 범례). DB마다 읽기 요청 1번.
 * 저장 순서가 곧 색 순서라, 이미 아는 DB 뒤에 붙인다(기존 DB의 색이 바뀌지 않게).
 * 일시 오류(5xx 등)나 토큰 문제면 그때까지 받은 이름은 저장하고 오류를 올린다(못 받은 DB는 다음 완성 때 다시 묻는다).
 */
export async function learnDatabaseNames(request: Requester, pages: readonly PageRecord[]): Promise<void> {
  const { databaseNames } = await chrome.storage.local.get('databaseNames');
  const known: Record<string, string> = { ...((databaseNames as Record<string, string> | undefined) ?? {}) };
  const missing = unknownDatabases(pages, known).slice(0, PER_RUN);
  if (missing.length === 0) return;
  try {
    for (const id of missing) known[id] = (await fetchDataSourceTitle(request, id)) ?? UNNAMED_DATABASE;
  } finally {
    await chrome.storage.local.set({ databaseNames: known });
  }
}
