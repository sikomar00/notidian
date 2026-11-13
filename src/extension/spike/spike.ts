import { readBlockTree, searchAllPages } from '../../notion/endpoints.ts';
import type { NotionObject, Requester } from '../../notion/endpoints.ts';
import { extractFromBlock, extractFromProperties } from '../../notion/extractLinks.ts';
import type { RelayResult } from '../background/relay.ts';
import type { Message } from '../messages.ts';

// 시험(Spike) 전용 패널. 페이지 제목·본문·토큰은 출력하지 않고 개수·시간·상태만 보여 준다.
export type Print = (line: string) => void;

const request: Requester = async (req) => {
  const reply = (await chrome.runtime.sendMessage({ type: 'notion-request', req } satisfies Message)) as RelayResult;
  if (!reply.ok) throw new Error(reply.error);
  return reply.res;
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const asObject = (value: unknown): NotionObject =>
  typeof value === 'object' && value !== null ? (value as NotionObject) : {};
const codeOf = (body: unknown): string => String(asObject(body).code ?? '-');

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function format(map: Map<string, number>): string {
  return [...map].map(([key, count]) => `${key}:${count}`).join(', ') || '(없음)';
}

export async function runS1(print: Print): Promise<void> {
  const start = performance.now();
  try {
    const res = await request({ method: 'GET', path: '/v1/users/me' });
    const body = asObject(res.body);
    const ms = Math.round(performance.now() - start);
    print(`S-1: 상태 ${res.status}, object=${String(body.object)}, type=${String(body.type)} (${ms}ms)`);
  } catch (error) {
    print(`S-1 실패(CORS·네트워크 가능성): ${message(error)}`);
  }
}

export async function runS2(print: Print): Promise<void> {
  const start = performance.now();
  try {
    const { pages, requests } = await searchAllPages(request);
    const parents = new Map<string, number>();
    let trashed = 0;
    let partial = 0;
    for (const page of pages) {
      bump(parents, `부모=${String(asObject(page.parent).type)}`);
      if (page.in_trash === true) trashed += 1;
      if (typeof page.last_edited_time !== 'string') partial += 1;
    }
    print(`S-2: 검색으로 ${pages.length}개 (요청 ${requests}번, ${((performance.now() - start) / 1000).toFixed(1)}초)`);
    print(`  ${format(parents)}`);
    print(`  휴지통 ${trashed}개, 수정 시각이 없는 부분 객체 ${partial}개`);
  } catch (error) {
    print(`S-2 실패: ${message(error)}`);
  }
}

function describeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/notion\.(so|com|site)$/.test(url.hostname)) return null;
  const segments = url.pathname.split('/').filter(Boolean).map((seg) => {
    if (/^[0-9a-f]{32}$/i.test(seg)) return '<id32>';
    if (/-[0-9a-f]{32}$/i.test(seg)) return '<슬러그>-<id32>';
    return seg.length <= 2 ? seg : '<문자>';
  });
  return `${url.hostname}/${segments.join('/')}${url.search ? '?<쿼리>' : ''}${url.hash ? '#<조각>' : ''}`;
}

function collectUrlShapes(value: unknown, shapes: Map<string, number>): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectUrlShapes(entry, shapes));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    const shape = (key === 'href' || key === 'url') && typeof entry === 'string' ? describeUrl(entry) : null;
    if (shape) bump(shapes, shape);
    else collectUrlShapes(entry, shapes);
  }
}

interface Sample {
  linkIds: Set<string>;
  shapes: Map<string, number>;
  failures: Map<string, number>;
  blocks: number;
  requests: number;
  read: number;
  ms: number;
}

async function readSample(pages: NotionObject[], size: number): Promise<Sample> {
  const sample: Sample = { linkIds: new Set(), shapes: new Map(), failures: new Map(), blocks: 0, requests: 0, read: 0, ms: 0 };
  const start = performance.now();
  for (const page of pages.slice(0, size)) {
    if (typeof page.id !== 'string') continue;
    try {
      const { blocks, requests } = await readBlockTree(request, page.id);
      sample.read += 1;
      sample.blocks += blocks.length;
      sample.requests += requests;
      for (const block of blocks) {
        extractFromBlock(block).forEach((id) => sample.linkIds.add(id));
        collectUrlShapes(block, sample.shapes);
      }
    } catch (error) {
      bump(sample.failures, message(error));
    }
    extractFromProperties(page.properties).forEach((id) => sample.linkIds.add(id));
    collectUrlShapes(page.properties, sample.shapes);
  }
  sample.ms = performance.now() - start;
  return sample;
}

async function probeUnknownTargets(ids: string[]): Promise<Map<string, number>> {
  const tally = new Map<string, number>();
  for (const id of ids) {
    const page = await request({ method: 'GET', path: `/v1/pages/${id}` });
    if (page.status === 200) {
      bump(tally, '페이지로 읽힘(검색에 없던 페이지)');
      continue;
    }
    const database = await request({ method: 'GET', path: `/v1/databases/${id}` });
    bump(tally, `페이지 ${page.status}(${codeOf(page.body)}) / 데이터베이스 ${database.status}`);
  }
  return tally;
}

export async function runS3S7(print: Print): Promise<void> {
  try {
    const { pages } = await searchAllPages(request);
    const sample = await readSample(pages, 50);
    const perPageMs = sample.read > 0 ? sample.ms / sample.read : 0;
    print(`S-3: ${sample.read}페이지 읽음, 요청 ${sample.requests}번, 블록 ${sample.blocks}개, ${(sample.ms / 1000).toFixed(1)}초`);
    print(`  페이지당 평균 ${(sample.requests / Math.max(sample.read, 1)).toFixed(1)}번·${Math.round(perPageMs)}ms → 전체 ${pages.length}개는 약 ${((perPageMs * pages.length) / 60000).toFixed(1)}분(추정)`);
    print(`  읽기 실패: ${format(sample.failures)}`);
    const known = new Set(pages.map((page) => String(page.id)));
    const unknown = [...sample.linkIds].filter((id) => !known.has(id));
    print(`S-7: 연결 대상 고유 ID ${sample.linkIds.size}개, 검색 목록에 없는 ID ${unknown.length}개`);
    print(`  Notion 주소 모양: ${format(sample.shapes)}`);
    print(`  검색에 없는 ID 5개 조회: ${format(await probeUnknownTargets(unknown.slice(0, 5)))}`);
  } catch (error) {
    print(`S-3·S-7 실패: ${message(error)}`);
  }
}

export async function runS4Snapshot(print: Print): Promise<void> {
  try {
    const { pages } = await searchAllPages(request);
    const snapshot = Object.fromEntries(pages.map((page) => [String(page.id), String(page.last_edited_time)]));
    await chrome.storage.local.set({ spikeSnapshot: snapshot });
    print(`S-4: 스냅샷 저장 (${pages.length}개). 이제 Notion에서 페이지를 고친 뒤 "S-4 비교"를 누르세요.`);
  } catch (error) {
    print(`S-4 스냅샷 실패: ${message(error)}`);
  }
}

export async function runS4Compare(print: Print): Promise<void> {
  try {
    const { spikeSnapshot } = await chrome.storage.local.get('spikeSnapshot');
    const before = asObject(spikeSnapshot);
    const { pages } = await searchAllPages(request);
    const changed = pages
      .filter((page) => before[String(page.id)] !== undefined && before[String(page.id)] !== String(page.last_edited_time))
      .map((page) => `${String(page.id).slice(0, 8)}(${String(page.last_edited_time)})`);
    const added = pages.filter((page) => before[String(page.id)] === undefined).length;
    print(`S-4 비교: 수정 시각이 바뀐 페이지 ${changed.length}개, 새로 보인 페이지 ${added}개`);
    print(`  바뀐 페이지(ID 앞 8자리): ${changed.slice(0, 10).join(', ') || '(없음)'}`);
  } catch (error) {
    print(`S-4 비교 실패: ${message(error)}`);
  }
}

export async function showReports(print: Print): Promise<void> {
  const { lastClick, graphReport } = await chrome.storage.session.get(['lastClick', 'graphReport']);
  const click = asObject(lastClick);
  print(`S-6 마지막 아이콘 클릭: ${lastClick ? `모드=${String(click.mode)}, 서비스 워커 깨어나는 중이었나=${String(click.cold)}, 결과=${String(click.result)}` : '(기록 없음)'}`);
  print(`S-5 마지막 그래프 화면: ${graphReport ? String(asObject(graphReport).report) : '(기록 없음)'}`);
}
