import { createGraphView } from '../src/extension/graph-view/render.ts';
import { applyPaletteVars, currentPalette } from '../src/extension/graph-view/palette.ts';
import { buildGraph } from '../src/graph/buildGraph.ts';
import type { PageRecord, RawLink } from '../src/graph/types.ts';

// NF-1 점검: 실제 그래프 그리기 코드에 가짜 점·선을 넣고 "첫 그림까지 시간"과 "프레임 속도"를 잰다
const MEASURE_MS = 3000;

function fakeData(nodeCount: number): { pages: PageRecord[]; links: RawLink[] } {
  let seed = 42;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pages = Array.from({ length: nodeCount }, (_, index): PageRecord => ({
    id: `page-${index}`,
    title: `가짜 페이지 ${index}`,
    kind: random() < 0.15 ? 'dbItem' : 'page',
    url: '',
    lastEdited: '2026-11-13T00:00:00.000Z',
    status: 'ok',
    failCount: 0,
  }));
  const links = Array.from({ length: Math.round(nodeCount * 2.5) }, (): RawLink => ({
    from: `page-${Math.floor(random() * nodeCount)}`,
    to: `page-${Math.floor(random() * nodeCount)}`,
  }));
  return { pages, links };
}

function hasPaintedPixel(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext('2d');
  if (!context) return false;
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const [r, g, b] = [data[0], data[1], data[2]];
  for (let i = 4; i < data.length; i += 4) if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) return true;
  return false;
}

function measure(container: HTMLElement, start: number): Promise<string> {
  return new Promise((resolve) => {
    let firstPaint: number | undefined;
    const frames: number[] = [];
    let last = performance.now();
    // requestAnimationFrame이 주는 시각은 프레임 시작 시각이라 측정 시작보다 앞설 수 있어서(음수가 나오던 원인) 직접 읽는다
    const tick = (): void => {
      const now = performance.now();
      const canvas = container.querySelector('canvas');
      if (firstPaint === undefined && canvas && hasPaintedPixel(canvas)) firstPaint = now - start;
      if (firstPaint !== undefined) frames.push(now - last);
      last = now;
      if (firstPaint !== undefined && now - start - firstPaint >= MEASURE_MS) {
        const average = frames.reduce((sum, frame) => sum + frame, 0) / Math.max(frames.length, 1);
        resolve(`첫 그림까지 ${Math.round(firstPaint)}ms, 이후 ${MEASURE_MS / 1000}초 동안 평균 ${(1000 / average).toFixed(0)}fps, 가장 긴 프레임 ${Math.round(Math.max(...frames))}ms`);
        return;
      }
      if (now - start > 30_000) {
        resolve('30초 안에 그려지지 않았습니다');
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function run(): Promise<void> {
  const out = document.getElementById('out');
  const container = document.getElementById('graph');
  if (!out || !container) return;
  const nodeCount = Number(new URLSearchParams(location.search).get('n') ?? 500);
  const palette = currentPalette();
  applyPaletteVars(palette);
  if (document.visibilityState !== 'visible') {
    out.textContent = `창이 보이지 않아 측정할 수 없습니다(visibilityState=${document.visibilityState}). 창을 앞으로 가져와 다시 여세요.`;
    return;
  }
  const { pages, links } = fakeData(nodeCount);
  const start = performance.now();
  let settledMs: number | undefined;
  const view = createGraphView(container, palette, {
    onNodeClick: () => undefined,
    onSettled: () => {
      settledMs ??= performance.now() - start;
    },
  });
  view.resize(container.clientWidth, container.clientHeight);
  view.setData(buildGraph(pages, links, { hierarchy: false }));
  const frames = await measure(container, start);
  while (settledMs === undefined && performance.now() - start < 30_000) await new Promise((resolve) => setTimeout(resolve, 200));
  const settled = settledMs === undefined ? '30초 넘음' : `${Math.round(settledMs)}ms`;
  out.textContent = `${nodeCount}점·선 ${links.length}개 — ${frames}, 배치가 멈출 때까지 ${settled}`;
}

void run();
