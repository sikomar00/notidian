import { UNNAMED_DATABASE } from '../background/databaseNames.ts';
import { assignGroups, groupLabel, GROUPS_KEY, MAX_GROUPS, parseGroups } from '../../graph/colorGroups.ts';
import type { ColorGroup } from '../../graph/colorGroups.ts';
import type { GraphData, PageRecord } from '../../graph/types.ts';
import { byId } from '../dom.ts';
import { renderDatabaseLegend } from './databaseLegend.ts';
import { renderGroupEditor } from './groupEditor.ts';
import type { EditorChoices } from './groupEditor.ts';
import type { Palette } from './palette.ts';
import type { GraphView } from './render.ts';

interface ColorsDeps {
  demo: boolean;
  palette: Palette;
  notice: HTMLElement;
  /** 지금 그래프(범례·보기 옵션 반영)와 저장된 페이지 */
  graph: () => GraphData;
  pages: () => ReadonlyMap<string, PageRecord>;
  view: () => GraphView | undefined;
  /** 그룹 이름이 바뀌어 선택 서랍의 "그룹:" 줄을 다시 그려야 할 때 */
  redrawSelection: () => void;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function legendItem(color: string, text: string): HTMLSpanElement {
  const item = document.createElement('span');
  const mark = document.createElement('span');
  mark.className = 'swatch page';
  mark.style.background = color;
  mark.setAttribute('aria-hidden', 'true');
  item.append(mark, text);
  return item;
}

// 고를 거리: 하위 페이지가 있는 페이지와 DB. 이름이 같으면(제목 없음 등) ID 앞자리를 붙여 구분한다
function editorChoices(pages: readonly PageRecord[], names: { database: (id: string) => string; page: (id: string) => string }, colors: readonly string[]): EditorChoices {
  const distinct = (items: { id: string; name: string }[]): { id: string; name: string }[] => {
    const counts = new Map<string, number>();
    for (const { name } of items) counts.set(name, (counts.get(name) ?? 0) + 1);
    return items
      .map((item) => ((counts.get(item.name) ?? 0) > 1 ? { ...item, name: `${item.name} · ${item.id.slice(0, 6)}` } : item))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  };
  const parentIds = new Set(pages.flatMap((page) => (page.parentPageId ? [page.parentPageId] : [])));
  const databaseIds = new Set(pages.flatMap((page) => (page.databaseId ? [page.databaseId] : [])));
  return {
    databases: distinct([...databaseIds].map((id) => ({ id, name: names.database(id) }))),
    parents: distinct([...parentIds].map((id) => ({ id, name: names.page(id) }))),
    colors,
  };
}

/**
 * 점 색을 맡는다: DB별 색(P2-3)과 색 그룹(F-35~F-37). 그룹 색이 먼저이고, 어느 그룹에도 안 걸린 점은 종류·DB별 색이다.
 * 그룹은 데이터·범례·그룹이 바뀔 때만 다시 계산하고, 그룹이 없으면 아무것도 하지 않는다.
 */
export function createColorsController({ demo, palette, notice, graph, pages, view, redrawSelection }: ColorsDeps) {
  const dbBox = byId<HTMLInputElement>('db-colors');
  const panel = byId('group-editor').closest('details');
  let databaseNames: Record<string, string> = {};
  let databaseNamesError: string | undefined;
  let dbColors: Map<string, string> | null = null;
  let groups: ColorGroup[] = [];
  let assigned = new Map<string, number>();
  let nodeColors: Map<string, string> | null = null;
  // 이 화면이 저장한 값(저장소 변경 알림으로 되돌아오면 무시한다. 빨리 여러 번 바꿀 때 옛 값으로 돌아가지 않게)
  const written = new Set<string>();

  const names = {
    database: (id: string): string => databaseNames[id] ?? UNNAMED_DATABASE,
    page: (id: string): string => pages().get(id)?.title || '(제목 없음)',
  };
  const labelOf = (group: ColorGroup): string => groupLabel(group.rule, names);

  // 지금 그래프에 있는 DB끼리만 색 순서를 매긴다(지워진 DB가 색 칸을 차지하지 않게). 순서는 처음 알게 된 순서
  function applyDatabaseColors(): void {
    const present = new Set(graph().nodes.flatMap((node) => (node.group ? [node.group] : [])));
    const shown = Object.fromEntries(Object.entries(databaseNames).filter(([id]) => present.has(id)));
    dbColors = renderDatabaseLegend(byId('db-legend'), dbBox.checked ? { names: shown, error: databaseNamesError } : null, palette);
    view()?.setGroupColors(dbColors);
  }

  // 상위 페이지 고리는 모든 페이지로 따지고(중간 페이지가 숨겨져도 그 아래가 빠지지 않게), 칠하고 세는 것은 보이는 점만
  function applyGroups(): void {
    const legend = byId('group-legend');
    legend.hidden = groups.length === 0;
    if (groups.length === 0 && nodeColors === null) return;
    const visible = new Set(graph().nodes.map((node) => node.id));
    assigned = new Map([...assignGroups([...pages().values()], groups)].filter(([id]) => visible.has(id)));
    const counts = groups.map(() => 0);
    nodeColors = groups.length === 0 ? null : new Map();
    for (const [id, index] of assigned) {
      counts[index] = (counts[index] ?? 0) + 1;
      const color = palette.groups[groups[index]?.color ?? 0];
      if (color) nodeColors?.set(id, color);
    }
    legend.replaceChildren(...groups.map((group, index) => legendItem(palette.groups[group.color] ?? '', `${labelOf(group)} ${counts[index] ?? 0}개`)));
    view()?.setNodeColors(nodeColors);
  }

  // 편집 칸은 메뉴가 열려 있을 때만 그리고, 그 안에서 쓰는 중이면(초점이 안에 있으면) 지도 갱신으로 다시 그리지 않는다
  function renderEditor(force = false): void {
    if (!panel?.open) return;
    if (!force && byId('group-editor').contains(document.activeElement)) return;
    renderGroupEditor(groups, editorChoices([...pages().values()], names, palette.groups), setGroups);
  }

  function setGroups(next: ColorGroup[]): void {
    groups = next.slice(0, MAX_GROUPS);
    if (!demo) {
      written.add(JSON.stringify(groups));
      chrome.storage.local.set({ [GROUPS_KEY]: groups }).catch((error: unknown) => (notice.textContent = `색 그룹을 기억하지 못했어요: ${message(error)}`));
    }
    renderEditor(true);
    applyGroups();
    redrawSelection();
  }

  byId('group-add').addEventListener('click', () => {
    const used = new Set(groups.map((group) => group.color));
    const color = palette.groups.findIndex((_, index) => !used.has(index));
    setGroups([...groups, { rule: { kind: 'title', value: '' }, color: Math.max(0, color) }]);
  });
  panel?.addEventListener('toggle', () => renderEditor(true));
  dbBox.addEventListener('change', applyDatabaseColors);
  if (!demo) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.databaseNames) databaseNames = (changes.databaseNames.newValue as Record<string, string> | undefined) ?? {};
      if (changes.databaseNamesError) databaseNamesError = changes.databaseNamesError.newValue as string | undefined;
      if (changes.databaseNames || changes.databaseNamesError) applyDatabaseColors();
      const change = changes[GROUPS_KEY];
      if (!change || written.delete(JSON.stringify(change.newValue ?? []))) return;
      // 다른 Notidian 화면에서 바꿨거나 저장된 데이터를 지웠으면 따라간다
      groups = parseGroups(change.newValue);
      renderEditor(true);
      applyGroups();
      redrawSelection();
    });
  }

  return {
    databaseNames: (): Record<string, string> => databaseNames,
    setDatabaseNames(next: Record<string, string>, error: string | undefined): void {
      databaseNames = next;
      databaseNamesError = error;
    },
    /** 데이터·범례·보기 옵션이 바뀌어 다시 그렸을 때 */
    rebuilt(): void {
      applyDatabaseColors();
      renderEditor();
      applyGroups();
    },
    /** 그래프를 늦게 만들었을 때(옆 패널) 정해 둔 색을 넘긴다 */
    applyTo(target: GraphView): void {
      target.setGroupColors(dbColors);
      target.setNodeColors(nodeColors);
    },
    /** 고른 페이지가 속한 그룹 이름(색만으로 구분하지 않게 패널에 글자로 적는다) */
    groupOf(id: string): string | undefined {
      const index = assigned.get(id);
      const group = index === undefined ? undefined : groups[index];
      return group ? labelOf(group) : undefined;
    },
    async init(): Promise<void> {
      if (demo) return;
      try {
        groups = parseGroups((await chrome.storage.local.get(GROUPS_KEY))[GROUPS_KEY]);
      } catch (error) {
        notice.textContent = `색 그룹을 읽지 못했어요: ${message(error)}`;
      }
    },
  };
}
