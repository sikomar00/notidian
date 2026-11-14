import type { PageRecord } from './types.ts';

/** 색 그룹 조건(F-35): 제목에 든 글자, 소속 DB, 상위 페이지(그 아래 전부). */
export type GroupRule =
  | { kind: 'title'; value: string }
  | { kind: 'database'; value: string }
  | { kind: 'parent'; value: string };

export interface ColorGroup {
  rule: GroupRule;
  /** 미리 정한 그룹 색 중 몇 번째인지(palette.groups) */
  color: number;
}

/** 저장소 열쇠. 색 그룹은 이 브라우저에만 두고 저장된 데이터 지우기로 함께 지운다(제목 글자·페이지 ID가 들어 있다) */
export const GROUPS_KEY = 'colorGroups';

/** 그룹은 이만큼까지 만든다(구분되는 색 수) */
export const MAX_GROUPS = 6;

const fold = (text: string): string => text.normalize('NFC').toLowerCase().trim();

// 상위 페이지를 따라 올라가며 조상을 모은다. 기록이 꼬여 고리가 생겨도 멈춘다
function ancestorsOf(id: string, parentOf: ReadonlyMap<string, string>): Set<string> {
  const found = new Set<string>();
  for (let parent = parentOf.get(id); parent !== undefined && !found.has(parent); parent = parentOf.get(parent)) found.add(parent);
  return found;
}

function matches(rule: GroupRule, page: PageRecord, ancestors: () => Set<string>): boolean {
  if (rule.kind === 'title') return rule.value.trim() !== '' && fold(page.title).includes(fold(rule.value));
  if (rule.kind === 'database') return page.databaseId === rule.value;
  return ancestors().has(rule.value);
}

/**
 * 페이지마다 속한 그룹 번호(목록에서 위에 있는 그룹이 먼저, F-36). 어느 그룹에도 안 걸리면 없다.
 * 읽을 수 없는 페이지는 제목·위치를 몰라 칠하지 않는다. 데이터가 바뀔 때 한 번만 부른다(그릴 때마다 부르지 않는다).
 */
export function assignGroups(pages: readonly PageRecord[], groups: readonly ColorGroup[]): Map<string, number> {
  const assigned = new Map<string, number>();
  if (groups.length === 0) return assigned;
  const parentOf = new Map(pages.flatMap((page) => (page.parentPageId ? [[page.id, page.parentPageId] as const] : [])));
  for (const page of pages) {
    if (page.status === 'unreadable') continue;
    let ancestors: Set<string> | undefined;
    const lazyAncestors = (): Set<string> => (ancestors ??= ancestorsOf(page.id, parentOf));
    const index = groups.findIndex((group) => matches(group.rule, page, lazyAncestors));
    if (index !== -1) assigned.set(page.id, index);
  }
  return assigned;
}

/** 그룹 이름(범례·패널): 제목 글자는 "회의" 포함, DB는 그 이름, 상위 페이지는 "프로젝트 A 아래". */
export function groupLabel(rule: GroupRule, names: { database: (id: string) => string; page: (id: string) => string }): string {
  if (rule.kind === 'title') return `"${rule.value.trim()}" 포함`;
  if (rule.kind === 'database') return names.database(rule.value);
  return `${names.page(rule.value)} 아래`;
}

/** 저장소에서 읽은 값을 확인한다(다른 버전·손상된 값은 버린다). */
export function parseGroups(value: unknown): ColorGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((group): group is ColorGroup => {
      const rule = (group as ColorGroup | undefined)?.rule;
      return (
        Number.isInteger((group as ColorGroup | undefined)?.color) &&
        ((group as ColorGroup).color >= 0 && (group as ColorGroup).color < MAX_GROUPS) &&
        typeof rule?.value === 'string' &&
        (rule.kind === 'title' || rule.kind === 'database' || rule.kind === 'parent')
      );
    })
    .slice(0, MAX_GROUPS);
}
