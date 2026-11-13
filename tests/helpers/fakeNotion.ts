import type { NotionRequest, NotionResponse } from '../../src/notion/http.ts';

export interface FakeBlock {
  id: string;
  type: string;
  children?: FakeBlock[];
  [key: string]: unknown;
}

export interface FakePage {
  id: string;
  title: string;
  parent: Record<string, unknown>;
  edited: string;
  blocks: FakeBlock[];
  relation?: string[];
  inTrash?: boolean;
  searchable?: boolean;
}

const ok = (body: unknown): NotionResponse => ({ status: 200, body });
const error = (status: number, code: string): NotionResponse => ({ status, body: { code } });

/** 메모리 안의 가짜 Notion. 요청 모양을 실제 API(2026-03-11)와 같게 흉내 낸다. */
export class FakeNotion {
  pages = new Map<string, FakePage>();
  databases = new Set<string>();
  forbidden = new Set<string>();
  searchPageSize = 100;
  calls: string[] = [];
  private injected: { match: string; responses: NotionResponse[] }[] = [];

  add(page: FakePage): void {
    this.pages.set(page.id, page);
  }

  /** 경로가 `match`를 포함하는 다음 요청들에 정해 둔 응답을 먼저 돌려준다. */
  inject(match: string, ...responses: NotionResponse[]): void {
    this.injected.push({ match, responses });
  }

  count(prefix: string): number {
    return this.calls.filter((call) => call.startsWith(prefix)).length;
  }

  request = async (req: NotionRequest): Promise<NotionResponse> => {
    const label = `${req.method} ${req.path}`;
    this.calls.push(label);
    const injected = this.injected.find((entry) => label.includes(entry.match) && entry.responses.length > 0);
    const next = injected?.responses.shift();
    if (next) return next;
    if (req.method === 'POST') return this.search(req.body);
    const parts = new URL(req.path, 'https://fake.local').pathname.split('/').filter(Boolean);
    const [, kind = '', id = '', sub = ''] = parts;
    if (kind === 'users') return ok({ object: 'user', type: 'bot' });
    if (kind === 'pages' && parts.length === 3) return this.getPage(id);
    if (kind === 'pages' && sub === 'properties') return this.relationItems(id);
    if (kind === 'blocks' && sub === 'children') return this.children(id);
    return error(404, 'object_not_found');
  };

  private pageObject(page: FakePage): Record<string, unknown> {
    const relation = page.relation;
    return {
      object: 'page',
      id: page.id,
      last_edited_time: page.edited,
      in_trash: page.inTrash === true,
      parent: page.parent,
      url: `https://app.notion.com/p/${page.id.replaceAll('-', '')}`,
      properties: {
        title: { id: 'title', type: 'title', title: [{ plain_text: page.title }] },
        ...(relation
          ? { 관련: { id: 'rel', type: 'relation', relation: relation.slice(0, 25).map((id) => ({ id })), has_more: relation.length > 25 } }
          : {}),
      },
    };
  }

  private search(body: unknown): NotionResponse {
    const { start_cursor: cursor, page_size: size } = body as { start_cursor?: string; page_size?: number };
    const visible = [...this.pages.values()]
      .filter((page) => page.searchable !== false && page.inTrash !== true && !this.forbidden.has(page.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const start = cursor ? Number(cursor) : 0;
    const end = start + Math.min(size ?? 100, this.searchPageSize);
    return ok({
      results: visible.slice(start, end).map((page) => this.pageObject(page)),
      has_more: end < visible.length,
      next_cursor: end < visible.length ? String(end) : null,
    });
  }

  private getPage(id: string): NotionResponse {
    if (this.databases.has(id)) return error(400, 'validation_error');
    const page = this.pages.get(id);
    if (!page || this.forbidden.has(id)) return error(404, 'object_not_found');
    return ok(this.pageObject(page));
  }

  private findBlocks(id: string): FakeBlock[] | undefined {
    const page = this.pages.get(id);
    if (page) return page.blocks;
    const walk = (blocks: FakeBlock[]): FakeBlock[] | undefined => {
      for (const block of blocks) {
        if (block.id === id) return block.children ?? [];
        const found = walk(block.children ?? []);
        if (found) return found;
      }
      return undefined;
    };
    for (const candidate of this.pages.values()) {
      const found = walk(candidate.blocks);
      if (found) return found;
    }
    return undefined;
  }

  private children(id: string): NotionResponse {
    if (this.forbidden.has(id)) return error(404, 'object_not_found');
    const blocks = this.findBlocks(id);
    if (!blocks) return error(404, 'object_not_found');
    const results = blocks.map(({ children, ...rest }) => ({ ...rest, has_children: (children?.length ?? 0) > 0 }));
    return ok({ results, has_more: false, next_cursor: null });
  }

  private relationItems(id: string): NotionResponse {
    const relation = this.pages.get(id)?.relation ?? [];
    const results = relation.map((target) => ({ object: 'property_item', type: 'relation', relation: { id: target } }));
    return ok({ results, has_more: false, next_cursor: null });
  }
}

export const uid = (n: number): string => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
export const hex = (id: string): string => id.replaceAll('-', '');
export const WORKSPACE = { type: 'workspace', workspace: true };
export const childOf = (id: string): Record<string, unknown> => ({ type: 'page_id', page_id: id });
export const DB_ITEM = { type: 'data_source_id', data_source_id: 'ds', database_id: 'db' };

export const mention = (id: string): Record<string, unknown> => ({
  type: 'mention',
  mention: { type: 'page', page: { id } },
  plain_text: '제목',
  href: `https://app.notion.com/p/${hex(id)}`,
});

export const link = (url: string): Record<string, unknown> => ({
  type: 'text',
  text: { content: '링크', link: { url } },
  plain_text: '링크',
  href: url,
});

export const paragraph = (id: string, ...richText: unknown[]): FakeBlock => ({
  id,
  type: 'paragraph',
  paragraph: { rich_text: richText },
});
