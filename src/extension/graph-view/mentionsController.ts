import { UNTITLED } from '../../graph/buildGraph.ts';
import type { PageRecord, RawLink, StoredText } from '../../graph/types.ts';
import type { ProgressPhase } from '../background/types.ts';
import { IGNORED_KEY, ignoredFrom, loadIgnored, updateIgnored } from '../ignoredTitles.ts';
import { createCleanupView } from './cleanupView.ts';
import type { CleanupRequest } from './cleanupView.ts';
import { createMentionsPanel } from './mentionsPanel.ts';
import { createTextCache } from './textCache.ts';

// 만드는 동안에도 새로 모은 글자가 나오게 이 간격마다 다시 불러온다(F-21). 2초마다 오는 갱신마다 하면 계산이 끝나기 전에 다시 시작된다
const TEXT_REFRESH_MS = 5000;

export interface MentionsData {
  pagesById: ReadonlyMap<string, PageRecord>;
  links: readonly RawLink[];
  /** 범례로 숨기지 않은, 읽을 수 있는 페이지. 외톨이 숨기기는 반영하지 않는다(정리할 외톨이가 빠지지 않게, F-26) */
  visible: ReadonlySet<string>;
}

interface ControllerDeps {
  demo: boolean;
  loadTexts: () => Promise<StoredText[]>;
  onOpen: (id: string) => void;
  notice: HTMLElement;
  data: () => MentionsData;
  /** 선택 서랍을 다시 그린다(그 안에서 `drawer`를 부른다) */
  redrawSelection: () => void;
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((item) => b.has(item));
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** 서랍의 연결 안 된 언급 칸(S2-7)과 언급 정리(S2-8)가 함께 쓰는 본문 글자·뺀 제목·갱신 시점을 맡는다. */
export function createMentionsController({ demo, loadTexts, onOpen, notice, data, redrawSelection }: ControllerDeps) {
  const texts = createTextCache(loadTexts);
  const panel = createMentionsPanel(texts, onOpen);
  let ignored = new Set<string>();
  let indexing = false;
  let loadedAt = 0;
  let cleanupShown = false;

  const titleOf = (id: string): string | undefined => {
    const page = data().pagesById.get(id);
    return page ? page.title || UNTITLED : undefined;
  };
  const request = (): CleanupRequest => ({ visible: data().visible, titleOf, links: data().links, running: indexing, ignored });

  const cleanup = createCleanupView({
    cache: texts,
    onOpen,
    onIgnore: (title, ignore) => {
      ignored = new Set(ignored);
      if (ignore) ignored.add(title);
      else ignored.delete(title);
      // 예시 모드는 저장하지 않는다
      if (!demo) updateIgnored(title, ignore).catch((error: unknown) => (notice.textContent = `뺀 제목을 기억하지 못했어요: ${message(error)}`));
      redrawSelection();
      if (ignore) cleanup.hideIgnored(request());
      else void cleanup.render(request());
    },
  });

  // 다른 Notidian 화면에서 빼거나, 설정에서 저장된 데이터를 지우면 따라간다
  if (!demo) {
    chrome.storage.onChanged.addListener((changes, area) => {
      const change = changes[IGNORED_KEY];
      if (area !== 'local' || !change) return;
      const next = ignoredFrom(change.newValue);
      if (sameSet(next, ignored)) return;
      ignored = next;
      redrawSelection();
      if (cleanupShown) void cleanup.render(request());
    });
  }

  function refresh(): void {
    texts.invalidate();
    loadedAt = Date.now();
    redrawSelection();
    if (cleanupShown) void cleanup.render(request());
  }

  return {
    /** 선택한 페이지의 칸을 그린다. 없거나 읽을 수 없는 페이지면 `undefined` */
    drawer(target: { id: string; title: string } | undefined): void {
      const links = data().links;
      const linkedFrom = new Set(target ? links.filter((link) => link.to === target.id).map((link) => link.from) : []);
      void panel.render({ target, linkedFrom, running: indexing, titleOf, ignored });
    },
    setCleanupShown(on: boolean): void {
      cleanupShown = on;
      if (on) void cleanup.render(request());
      else cleanup.cancel();
    },
    /** 저장된 지도를 다시 읽었을 때. 만드는 중에는 `progress`의 간격을 따른다 */
    dataReloaded(): void {
      if (!indexing) texts.invalidate();
    },
    /** 범례·스위치로 다시 그렸을 때 */
    rebuilt(): void {
      if (cleanupShown && !indexing) void cleanup.render(request());
    },
    progress(phase: ProgressPhase): void {
      const finished = indexing && phase !== 'running';
      indexing = phase === 'running';
      if (finished || (indexing && Date.now() - loadedAt > TEXT_REFRESH_MS)) refresh();
    },
    async init(): Promise<void> {
      if (demo) return;
      try {
        ignored = await loadIgnored();
      } catch (error) {
        // 뺀 제목을 못 읽어도 지도는 보여 준다
        notice.textContent = `뺀 제목을 읽지 못했어요: ${message(error)}`;
      }
    },
  };
}
