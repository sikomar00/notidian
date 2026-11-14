import { findUnlinkedMentions, prepareTexts } from '../../graph/unlinkedMentions.ts';
import type { Mention, PreparedText } from '../../graph/unlinkedMentions.ts';
import type { StoredText } from '../../graph/types.ts';
import { byId } from '../dom.ts';

// 받은·보낸 연결 목록과 같은 한도. 흔한 제목은 결과가 많을 수 있다
const MAX_ITEMS = 50;

export interface MentionsRequest {
  /** 고른 페이지. 없거나 읽을 수 없는 페이지면 칸을 숨긴다 */
  target: { id: string; title: string } | undefined;
  /** 이미 target으로 연결이 있는 페이지 */
  linkedFrom: ReadonlySet<string>;
  /** 연결 지도를 만드는 중인지(결과가 더 나올 수 있다) */
  running: boolean;
  /** 결과 줄에 쓸 페이지 제목(제목 없는 페이지는 "(제목 없음)"). 지도에 없는 페이지(지워진 페이지의 남은 글자 등)는 undefined */
  titleOf: (id: string) => string | undefined;
}

function note(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.textContent = text;
  return li;
}

// 한 줄: 페이지 제목, 처음 나온 곳의 앞뒤 글자(찾은 글자만 굵게), 나온 횟수
function mentionItem(mention: Mention, onOpen: (id: string) => void): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.id = mention.id;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mention';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = mention.title;
  const snippet = document.createElement('span');
  snippet.className = 'snippet';
  const match = document.createElement('strong');
  match.textContent = mention.match;
  snippet.append(`“${mention.before}`, match, `${mention.after}”`);
  button.append(name, ` · ${mention.count}곳`, snippet);
  button.addEventListener('click', () => onOpen(mention.id));
  li.append(button);
  return li;
}

/**
 * 선택한 페이지의 연결 안 된 언급 칸(S2-7). 본문 글자는 처음 그릴 때 한 번 불러 두고,
 * `invalidate()` 뒤 다음 그릴 때 다시 불러온다(저장된 지도를 다시 읽었을 때·다 만들었을 때).
 */
export function createMentionsPanel(loadTexts: () => Promise<StoredText[]>, onOpen: (id: string) => void) {
  const section = byId('mentions');
  const heading = byId('mention-title');
  const status = byId('mentions-note');
  const list = byId('sel-mentions');
  let texts: Promise<PreparedText[]> | undefined;
  let ticket = 0;

  function show(results: Mention[], running: boolean): void {
    heading.textContent = `연결 안 된 언급 ${results.length}개`;
    status.textContent = running ? '연결 지도를 만드는 중이라 더 나올 수 있어요' : results.length === 0 ? '글자로만 적은 곳이 없어요' : '';
    // 다시 그려도 키보드 초점이 있던 줄에 초점을 되돌린다(받은·보낸 연결 목록과 같게)
    const focusedId = list.contains(document.activeElement) ? document.activeElement?.closest('li')?.dataset.id : undefined;
    const items = results.slice(0, MAX_ITEMS).map((mention) => mentionItem(mention, onOpen));
    if (results.length > MAX_ITEMS) items.push(note(`${results.length - MAX_ITEMS}개 더 있어요`));
    list.replaceChildren(...items);
    if (focusedId !== undefined) list.querySelector<HTMLElement>(`li[data-id="${CSS.escape(focusedId)}"] button`)?.focus();
  }

  function showNote(text: string): void {
    heading.textContent = '연결 안 된 언급';
    status.textContent = text;
    list.replaceChildren();
  }

  async function render({ target, linkedFrom, running, titleOf }: MentionsRequest): Promise<void> {
    const mine = ++ticket;
    section.hidden = target === undefined;
    if (!target) return;
    let stored: PreparedText[];
    try {
      // 글자 정리(NFC·소문자)는 불러올 때 한 번만 한다. 다시 그릴 때마다 전체 글자를 다시 훑지 않게
      texts ??= loadTexts().then((loaded) => prepareTexts(loaded, titleOf));
      stored = await texts;
    } catch (error) {
      texts = undefined;
      if (mine === ticket) showNote(`본문 글자를 읽지 못했어요: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (mine !== ticket) return;
    // 처음 만드는 중이면 아직 글자가 없어도 "다시 만들기" 대신 지금까지 찾은 것(0개)과 진행 안내를 보여 준다
    if (stored.length === 0 && !running) {
      showNote('다시 만들기를 하면 보여요');
      return;
    }
    const results = findUnlinkedMentions(target, stored, linkedFrom);
    if (results === 'too-short') showNote('제목이 너무 짧아서 찾지 않아요');
    else show(results, running);
  }

  return {
    render,
    invalidate(): void {
      texts = undefined;
    },
  };
}
