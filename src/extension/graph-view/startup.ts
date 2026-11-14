import { IDLE_PROGRESS } from '../background/types.ts';
import type { Progress, ProgressPhase } from '../background/types.ts';
import { hasToken as tokenPresent, tokenChanged } from '../tokenStore.ts';

interface StatusLike {
  setProgress(progress: Progress): void;
  setHasToken(present: boolean): void;
}

interface LoadDeps {
  status: StatusLike;
  mentions: { init(): Promise<void>; progress(phase: ProgressPhase): void };
  colors: { init(): Promise<void>; setDatabaseNames(names: Record<string, string>, error: string | undefined): void };
}

interface WatchDeps {
  status: StatusLike;
  reloader: { schedule(running: boolean): void };
  mentions: { progress(phase: ProgressPhase): void };
}

/**
 * 저장된 진행 상태·토큰 여부·DB 이름·뺀 제목·색 그룹을 읽어 화면에 넣고, 아이콘을 누른 순간의 지금 페이지 ID를 돌려준다.
 * (예시 모드는 부르지 않는다)
 */
export async function loadSaved({ status, mentions, colors }: LoadDeps): Promise<string | null> {
  const [local, session, present] = await Promise.all([
    chrome.storage.local.get(['progress', 'databaseNames', 'databaseNamesError']),
    chrome.storage.session.get('focusPageId'),
    tokenPresent(),
  ]);
  status.setHasToken(present);
  await Promise.all([mentions.init(), colors.init()]);
  colors.setDatabaseNames((local.databaseNames as Record<string, string> | undefined) ?? {}, local.databaseNamesError as string | undefined);
  const progress = (local.progress as Progress | undefined) ?? IDLE_PROGRESS;
  status.setProgress(progress);
  mentions.progress(progress.phase);
  return typeof session.focusPageId === 'string' ? session.focusPageId : null;
}

/** 진행 상태(다시 읽기·언급 칸 갱신)·토큰·지금 페이지가 바뀌면 따라간다. DB 이름·색 그룹·뺀 제목은 각 담당이 따로 듣는다. */
export function watchStorage(deps: WatchDeps, onFocusPage: (id: string | null) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    const progress = changes.progress?.newValue as Progress | undefined;
    if (area === 'local' && progress) {
      deps.status.setProgress(progress);
      deps.reloader.schedule(progress.phase === 'running');
      deps.mentions.progress(progress.phase);
    }
    if (tokenChanged(changes, area)) void tokenPresent().then(deps.status.setHasToken);
    const pageId: unknown = changes.focusPageId?.newValue;
    if (area === 'session' && changes.focusPageId) onFocusPage(typeof pageId === 'string' ? pageId : null);
  });
}
