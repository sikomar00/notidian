import { MAX_GROUPS } from '../../graph/colorGroups.ts';
import type { ColorGroup, GroupRule } from '../../graph/colorGroups.ts';
import { byId } from '../dom.ts';
import { GROUP_COLOR_NAMES } from './palette.ts';

export interface EditorChoices {
  /** 고를 수 있는 DB(ID·이름) */
  databases: { id: string; name: string }[];
  /** 하위 페이지가 있는 페이지(ID·제목) */
  parents: { id: string; name: string }[];
  colors: readonly string[];
}

const KIND_TEXT: Record<GroupRule['kind'], string> = { title: '제목에 든 글자', database: 'DB', parent: '상위 페이지 아래' };

interface SelectSpec {
  label: string;
  options: readonly [string, string][];
  value: string;
  onChange: (value: string) => void;
}

function select({ label, options, value, onChange }: SelectSpec): HTMLSelectElement {
  const element = document.createElement('select');
  element.setAttribute('aria-label', label);
  for (const [optionValue, text] of options) element.append(new Option(text, optionValue, false, optionValue === value));
  element.addEventListener('change', () => onChange(element.value));
  return element;
}

interface ButtonSpec {
  text: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function iconButton({ text, label, onClick, disabled = false }: ButtonSpec): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.disabled = disabled;
  button.addEventListener('click', onClick);
  return button;
}

// 조건 값 칸: 제목 글자는 입력칸(다 쓰고 나서 바꾼다), DB·상위 페이지는 고르는 칸.
// 저장된 값이 지금 지도에 없으면(아직 안 읽은 페이지 등) "고르세요"로 보이지 않게 그 값을 따로 보여 준다
function valueInput(rule: GroupRule, choices: EditorChoices, spec: Omit<SelectSpec, 'options' | 'value'>): HTMLElement {
  if (rule.kind === 'title') {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = rule.value;
    input.placeholder = '예: 회의';
    input.setAttribute('aria-label', spec.label);
    input.addEventListener('change', () => spec.onChange(input.value));
    return input;
  }
  const options: [string, string][] = (rule.kind === 'database' ? choices.databases : choices.parents).map(({ id, name }) => [id, name]);
  const missing: [string, string][] = rule.value !== '' && !options.some(([id]) => id === rule.value) ? [[rule.value, '(지금 지도에 없음)']] : [];
  return select({ ...spec, options: [['', '고르세요'], ...missing, ...options], value: rule.value });
}

// 바뀐 뒤 초점을 둘 칸의 이름표. ↑↓은 옮겨 간 그룹의 같은 버튼, 지우면 그 자리 그룹(없으면 "그룹 추가")
let nextFocus: string | null = null;

/** "보기·내보내기" 안의 색 그룹 편집(F-35·F-36): 줄마다 색·조건·값·위로·아래로·지우기, 아래에 "그룹 추가". */
export function renderGroupEditor(groups: readonly ColorGroup[], choices: EditorChoices, onChange: (groups: ColorGroup[]) => void): void {
  const list = byId('group-editor');
  const add = byId<HTMLButtonElement>('group-add');
  const change = (index: number, next: Partial<ColorGroup>): void => onChange(groups.map((group, i) => (i === index ? { ...group, ...next } : group)));
  const move = (index: number, by: number): void => {
    const next = [...groups];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(index + by, 0, moved);
    const to = index + by;
    // 맨 위·아래로 가서 같은 버튼이 꺼지면 반대 방향 버튼으로
    const atEdge = by < 0 ? to === 0 : to === next.length - 1;
    nextFocus = `그룹 ${to + 1} ${(by < 0) !== atEdge ? '위로' : '아래로'}`;
    onChange(next);
  };
  const remove = (index: number): void => {
    const left = groups.length - 1;
    nextFocus = left === 0 ? null : `그룹 ${Math.min(index, left - 1) + 1} 지우기`;
    onChange(groups.filter((_, i) => i !== index));
    if (left === 0) add.focus();
  };
  // 다시 그려도 키보드 초점이 있던 칸(같은 이름표)으로 돌아간다
  const focused = nextFocus ?? (list.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : null);
  nextFocus = null;
  list.replaceChildren(
    ...groups.map((group, index) => {
      const li = document.createElement('li');
      const n = index + 1;
      const swatch = document.createElement('span');
      swatch.className = 'swatch page';
      swatch.style.background = choices.colors[group.color] ?? '';
      swatch.setAttribute('aria-hidden', 'true');
      li.append(
        swatch,
        select({ label: `그룹 ${n} 색`, options: GROUP_COLOR_NAMES.map((name, i) => [String(i), name]), value: String(group.color), onChange: (value) => change(index, { color: Number(value) }) }),
        select({ label: `그룹 ${n} 조건`, options: Object.entries(KIND_TEXT) as [string, string][], value: group.rule.kind, onChange: (kind) => change(index, { rule: { kind: kind as GroupRule['kind'], value: '' } }) }),
        valueInput(group.rule, choices, { label: `그룹 ${n} ${KIND_TEXT[group.rule.kind]}`, onChange: (value) => change(index, { rule: { ...group.rule, value } }) }),
        iconButton({ text: '↑', label: `그룹 ${n} 위로`, onClick: () => move(index, -1), disabled: index === 0 }),
        iconButton({ text: '↓', label: `그룹 ${n} 아래로`, onClick: () => move(index, 1), disabled: index === groups.length - 1 }),
        iconButton({ text: '×', label: `그룹 ${n} 지우기`, onClick: () => remove(index) }),
      );
      return li;
    }),
  );
  add.disabled = groups.length >= MAX_GROUPS;
  if (focused) list.querySelector<HTMLElement>(`[aria-label="${CSS.escape(focused)}"]`)?.focus();
}
