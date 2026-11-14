import type { LinkedPages } from '../../graph/rows.ts';
import type { GraphNode, LinkEvidence } from '../../graph/types.ts';
import { byId } from '../dom.ts';
import { evidenceLine } from './mentionSnippet.ts';

/** 상대 페이지와 방향(받은: 상대 → 고른 페이지, 보낸: 고른 페이지 → 상대)으로 연결 근거를 찾는다 */
export type EvidenceOf = (otherId: string, direction: 'in' | 'out') => LinkEvidence | undefined;

// 연결이 아주 많은 허브도 2초마다 다시 그리므로 목록마다 이만큼만 보여 준다. 나머지는 목록 보기에서 찾는다
const MAX_ITEMS = 50;

function item(text: string): HTMLLIElement {
  const li = document.createElement('li');
  li.textContent = text;
  return li;
}

// 한 줄: 페이지 이름(누르면 그 페이지를 고름)과 그 아래 왜 연결됐는지(F-28·F-29)
function pageItem(node: GraphNode, onPick: (id: string) => void, evidence: LinkEvidence | undefined): HTMLLIElement {
  const li = document.createElement('li');
  li.dataset.id = node.id;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = node.title;
  button.addEventListener('click', () => onPick(node.id));
  li.append(button);
  const line = evidenceLine(evidence);
  if (line) li.append(line);
  return li;
}

function fill(list: HTMLElement, nodes: readonly GraphNode[], itemOf: (node: GraphNode) => HTMLLIElement): void {
  // 색인 중 2초마다 다시 그려도 키보드 초점이 있던 페이지 버튼에 초점을 되돌린다
  const focusedId = list.contains(document.activeElement) ? document.activeElement?.closest('li')?.dataset.id : undefined;
  const items = nodes.slice(0, MAX_ITEMS).map((node) => itemOf(node));
  if (nodes.length === 0) items.push(item('없어요'));
  if (nodes.length > MAX_ITEMS) items.push(item(`외 ${nodes.length - MAX_ITEMS}개는 목록 보기에서 찾아 주세요`));
  list.replaceChildren(...items);
  if (focusedId !== undefined) list.querySelector<HTMLElement>(`li[data-id="${CSS.escape(focusedId)}"] button`)?.focus();
}

/** 선택한 페이지의 받은 연결(백링크)과 보낸 연결, 줄마다 연결 근거. 제목을 누르면 그 페이지를 고른다. 선택이 없으면 비운다. */
export function renderLinks(linked: LinkedPages | undefined, onPick: (id: string) => void, evidenceOf: EvidenceOf): void {
  byId('in-title').textContent = linked ? `받은 연결 ${linked.incoming.length}개` : '받은 연결';
  byId('out-title').textContent = linked ? `보낸 연결 ${linked.outgoing.length}개` : '보낸 연결';
  if (!linked) {
    byId('sel-in').replaceChildren();
    byId('sel-out').replaceChildren();
    return;
  }
  fill(byId('sel-in'), linked.incoming, (node) => pageItem(node, onPick, evidenceOf(node.id, 'in')));
  fill(byId('sel-out'), linked.outgoing, (node) => pageItem(node, onPick, evidenceOf(node.id, 'out')));
}
