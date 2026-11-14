/** 이름표 후보: 그래프 좌표의 글자 상자, 우선순위(작을수록 먼저), 같은 우선순위 안의 무게(클수록 먼저). */
export interface LabelBox {
  id: string;
  text: string;
  /** 글자 상자 왼쪽 위와 크기(그래프 좌표) */
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
  weight: number;
  /** 겹쳐도 늘 놓는다(고른 점·마우스를 올린 점) */
  always: boolean;
}

export const LABEL_PRIORITY = { focus: 0, hover: 1, related: 2, hub: 3, other: 4 } as const;

export interface LabelContext {
  focusId: string | null;
  hoverId: string | null;
  neighbors: ReadonlyMap<string, ReadonlySet<string>>;
  hubIds: ReadonlySet<string>;
}

/**
 * 이름표 우선순위: 고른 점 → 마우스를 올린 점 → 그 이웃(올린 점, 없으면 고른 점의) → 허브 → 나머지(확대했을 때만).
 * 다른 점에 마우스를 올려 고른 점이 흐려지면, 고른 점은 허브처럼 다룬다(강조 중인 이웃의 자리를 빼앗지 않게).
 */
export function labelPriority({ focusId, hoverId, neighbors, hubIds }: LabelContext, id: string): number {
  const nearHover = hoverId !== null && (id === hoverId || neighbors.get(hoverId)?.has(id) === true);
  if (id === focusId) return hoverId === null || nearHover ? LABEL_PRIORITY.focus : LABEL_PRIORITY.hub;
  if (id === hoverId) return LABEL_PRIORITY.hover;
  const around = hoverId ?? focusId;
  if (around !== null && neighbors.get(around)?.has(id)) return LABEL_PRIORITY.related;
  return hubIds.has(id) ? LABEL_PRIORITY.hub : LABEL_PRIORITY.other;
}

const overlaps = (a: LabelBox, b: LabelBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * 겹치지 않게 그릴 이름표를 고른다. 우선순위가 높은 것부터 놓고 이미 놓인 것과 겹치면 건너뛴다.
 * `always`인 것은 겹쳐도 놓는다. `max`개까지만 놓는다(비교가 개수의 제곱으로 늘어난다).
 */
export function pickLabels(candidates: readonly LabelBox[], max: number): LabelBox[] {
  const ordered = [...candidates].sort((a, b) => a.priority - b.priority || b.weight - a.weight);
  const placed: LabelBox[] = [];
  for (const box of ordered) {
    if (placed.length >= max) break;
    if (box.always || !placed.some((other) => overlaps(box, other))) placed.push(box);
  }
  return placed;
}

/** 이름표 글자 폭 상한(화면 px). 넘는 제목은 말줄임으로 잘라 긴 제목 하나가 주변 이름표를 다 가리지 않게 한다 */
export const MAX_LABEL_WIDTH = 160;

/** `measure`(12px 글자 폭)로 재서 상한을 넘으면 뒤를 "…"로 자른다. 결과는 호출하는 쪽이 제목마다 기억해 둔다. */
export function fitLabel(title: string, measure: (text: string) => number): { text: string; width: number } {
  const full = measure(title);
  if (full <= MAX_LABEL_WIDTH) return { text: title, width: full };
  const chars = [...title];
  let [low, high] = [0, chars.length];
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${chars.slice(0, mid).join('')}…`) <= MAX_LABEL_WIDTH) low = mid;
    else high = mid - 1;
  }
  const text = `${chars.slice(0, low).join('')}…`;
  return { text, width: measure(text) };
}

// 화면 비율을 이만큼 안으로 묶는다(아주 납작한 칸에서 한쪽 당김이 0에 가까워지지 않게)
const MIN_RATIO = 0.5;
const MAX_RATIO = 2;

/**
 * 가운데로 당기는 힘을 화면 모양에 맞춰 가로·세로로 나눈다. 가로로 긴 화면은 세로로 더 세게 당겨 그래프가 화면을 따라 퍼진다.
 * 크기가 0이면(목록 보기로 숨김) 지난 값을 그대로 쓰도록 null.
 */
export function pullFor(width: number, height: number, strength: number): { x: number; y: number } | null {
  if (width <= 0 || height <= 0) return null;
  const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, height / width));
  return ratio < 1 ? { x: strength * ratio, y: strength } : { x: strength, y: strength / ratio };
}
