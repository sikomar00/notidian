import type { GraphLink, LinkEvidence } from '../../graph/types.ts';
import { evidenceLine } from './mentionSnippet.ts';

/** 말풍선 한 줄: 어느 쪽에서 어느 쪽으로, 어떤 관계인지. */
export interface TooltipRow {
  from: string;
  to: string;
  relation: 'link' | 'child';
  evidence?: LinkEvidence;
}

interface TooltipSource {
  titleOf: (id: string) => string;
  evidenceOf: (from: string, to: string) => LinkEvidence | undefined;
}

/** 선 하나의 말풍선 줄들(F-33): 하위 페이지 선은 하위 관계 하나, 양쪽으로 이어진 선은 두 방향. */
export function tooltipRows(link: Pick<GraphLink, 'source' | 'target' | 'bidirectional' | 'hierarchy'>, source: TooltipSource): TooltipRow[] {
  const { titleOf, evidenceOf } = source;
  const [a, b] = [link.source, link.target];
  if (link.hierarchy) return [{ from: titleOf(a), to: titleOf(b), relation: 'child' }];
  const row = (from: string, to: string): TooltipRow => {
    const evidence = evidenceOf(from, to);
    return { from: titleOf(from), to: titleOf(to), relation: 'link', ...(evidence ? { evidence } : {}) };
  };
  return link.bidirectional ? [row(a, b), row(b, a)] : [row(a, b)];
}

// 커서에서 이만큼 떨어뜨려 말풍선이 커서를 가리지 않게 한다
const OFFSET = 14;

type Size = { width: number; height: number };
const clamp = (value: number, max: number): number => Math.max(0, Math.min(value, max));

/**
 * 말풍선 자리(F-34): 커서 오른쪽(안 들어가면 왼쪽)·아래(안 들어가면 위). 좌우 어디에도 안 들어가면(좁은 옆 패널)
 * 커서 위나 아래로 옮겨 가로로 가운데 맞춘다. 늘 그래프 영역 안에 두고, 커서와 그 아래 선을 가리지 않는다.
 */
export function placeTooltip(point: { x: number; y: number }, box: Size, area: Size): { left: number; top: number } {
  const [right, left] = [point.x + OFFSET, point.x - OFFSET - box.width];
  const [below, above] = [point.y + OFFSET, point.y - OFFSET - box.height];
  const fitsBelow = below + box.height <= area.height;
  const top = clamp(fitsBelow ? below : above, area.height - box.height);
  if (right + box.width <= area.width) return { left: right, top };
  if (left >= 0) return { left, top };
  return { left: clamp(point.x - box.width / 2, area.width - box.width), top };
}

/** 선 위 근거 말풍선(F-33·F-34). 마우스 전용이라 화면 읽기 프로그램에는 숨기고, 같은 내용은 패널의 받은·보낸 연결에 있다. */
export function createLinkTooltip(area: HTMLElement, source: TooltipSource) {
  const box = document.createElement('div');
  box.className = 'link-tooltip';
  box.setAttribute('aria-hidden', 'true');
  box.hidden = true;
  area.append(box);

  function rowElement(row: TooltipRow): HTMLDivElement {
    const line = document.createElement('div');
    const names = document.createElement('div');
    const [from, to] = [document.createElement('strong'), document.createElement('strong')];
    from.textContent = row.from;
    to.textContent = row.to;
    if (row.relation === 'child') names.append(from, '의 하위 페이지 ', to);
    else names.append(from, ' → ', to);
    line.append(names, row.relation === 'child' ? '' : evidenceLine(row.evidence) ?? '연결');
    return line;
  }

  // 같은 선 위에서 마우스만 움직이면 내용은 그대로 두고 자리만 옮긴다(마우스 움직임마다 다시 만들지 않게)
  let shownKey: string | null = null;
  let size = { width: 0, height: 0 };
  let lastPoint = { x: Number.NaN, y: Number.NaN };

  return {
    show(link: GraphLink, point: { x: number; y: number }): void {
      const key = `${link.source}|${link.target}|${link.hierarchy}`;
      const rebuilt = key !== shownKey || box.hidden;
      if (rebuilt) {
        box.replaceChildren(...tooltipRows(link, source).map(rowElement));
        box.hidden = false;
        size = { width: box.offsetWidth, height: box.offsetHeight };
        shownKey = key;
      }
      // 같은 선, 같은 자리면 아무것도 바꾸지 않는다(다시 판정이 자주 와도 레이아웃을 읽지 않게)
      if (!rebuilt && point.x === lastPoint.x && point.y === lastPoint.y) return;
      lastPoint = point;
      const position = placeTooltip(point, size, { width: area.clientWidth, height: area.clientHeight });
      box.style.left = `${position.left}px`;
      box.style.top = `${position.top}px`;
    },
    hide(): void {
      box.hidden = true;
      shownKey = null;
    },
  };
}
