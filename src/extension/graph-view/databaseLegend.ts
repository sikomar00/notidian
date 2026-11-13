import { databaseColors } from './palette.ts';
import type { Palette } from './palette.ts';

// 범례에 DB 이름과 색을 보여 준다. 처음 알게 된 두 DB만 색이 따로 있고, 나머지는 "기타 DB" 한 줄로 묶는다
function swatch(color: string, label: string): HTMLSpanElement {
  const item = document.createElement('span');
  const mark = document.createElement('span');
  mark.className = 'swatch db';
  mark.style.background = color;
  mark.setAttribute('aria-hidden', 'true');
  item.append(mark, label);
  return item;
}

/** DB별 색을 켜면 DB마다의 색(점을 칠할 때 쓴다)을 돌려주고 범례를 그린다. 끄면 null. 이름을 못 읽은 이유가 있으면 함께 보여 준다. */
export function renderDatabaseLegend(
  legend: HTMLElement,
  databases: { names: Readonly<Record<string, string>>; error: string | undefined } | null,
  palette: Palette,
): Map<string, string> | null {
  legend.hidden = databases === null;
  if (databases === null) return null;
  const { names, error } = databases;
  const order = Object.keys(names);
  const colors = databaseColors(order, palette);
  const named = order.slice(0, palette.databases.length).map((id) => swatch(colors.get(id) ?? palette.otherDatabase, names[id] ?? ''));
  const others = order.length - named.length;
  const items = others > 0 ? [...named, swatch(palette.otherDatabase, `기타 DB ${others}개`)] : named;
  const note = error ? [document.createTextNode(`DB 이름을 다 읽지 못했어요(다음에 다시 시도해요): ${error}`)] : [];
  legend.replaceChildren(...(items.length > 0 ? items : [document.createTextNode('DB 이름은 연결 지도를 다 만든 뒤에 보여요')]), ...note);
  return colors;
}
