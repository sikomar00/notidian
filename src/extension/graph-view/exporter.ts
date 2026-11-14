import { linksCsv, pagesCsv } from '../../graph/exportCsv.ts';
import type { NodeRow } from '../../graph/rows.ts';
import type { GraphData, PageRecord } from '../../graph/types.ts';
import { byId } from '../dom.ts';

export interface ExportSource {
  /** 필터를 반영한 그래프와 목록 보기의 줄(주변만 보기는 빼고, 화면의 목록·받은/보낸 연결 수와 같게) */
  graph(): GraphData;
  rows(): readonly NodeRow[];
  pages(): ReadonlyMap<string, PageRecord>;
  databaseNames(): Readonly<Record<string, string>>;
  urlOf(id: string): string;
  /** 목록 보기 중이면 그래프 그림이 없다 */
  showingList(): boolean;
  /** 그래프 바탕색(그림 파일은 투명하지 않게 이 색을 깐다) */
  background: string;
  /** 예시로 둘러보는 중이면 내 지도와 헷갈리지 않게 파일 이름에 "예시"를 붙인다 */
  demo(): boolean;
}

const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
};

const prefix = (source: ExportSource): string => (source.demo() ? 'notidian-예시-' : 'notidian-');

// 파일은 이 PC에 내려받기만 한다(다른 곳으로 보내지 않는다)
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// force-graph는 바탕을 CSS로만 칠해서 캔버스 자체는 투명하다. 다른 바탕의 문서에 넣어도 보이게 바탕색을 깐 사본으로 저장한다
function withBackground(canvas: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, copy.width, copy.height);
  ctx.drawImage(canvas, 0, 0);
  return copy;
}

function savePng(source: ExportSource, notice: HTMLElement): void {
  if (source.showingList()) {
    notice.textContent = '그래프 그림은 "그래프로 보기"에서 저장할 수 있어요.';
    return;
  }
  if (source.graph().nodes.length === 0) {
    notice.textContent = '그릴 점이 없어요. 범례나 "보기·내보내기"에서 숨긴 종류를 다시 보이게 해 주세요.';
    return;
  }
  const canvas = document.querySelector<HTMLCanvasElement>('#graph canvas');
  if (!canvas || canvas.width === 0) {
    notice.textContent = '그래프가 아직 그려지지 않았어요. 잠시 뒤 다시 눌러 주세요.';
    return;
  }
  withBackground(canvas, source.background).toBlob((blob) => {
    if (!blob) {
      notice.textContent = '그래프 그림을 만들지 못했어요.';
      return;
    }
    notice.textContent = '';
    download(`${prefix(source)}그래프-${today()}.png`, blob);
  }, 'image/png');
}

/** 내보내기(P2-8): 그래프 그림(PNG), 페이지 목록·연결 목록(CSV). */
export function setupExport(source: ExportSource, notice: HTMLElement): void {
  const saveCsv = (name: string, csv: string): void => {
    notice.textContent = '';
    download(`${prefix(source)}${name}-${today()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  };
  byId('export-png').addEventListener('click', () => savePng(source, notice));
  byId('export-pages').addEventListener('click', () => {
    saveCsv('페이지', pagesCsv(source.rows(), { pages: source.pages(), databaseNames: source.databaseNames(), urlOf: source.urlOf }));
  });
  byId('export-links').addEventListener('click', () => saveCsv('연결', linksCsv(source.graph())));
}
