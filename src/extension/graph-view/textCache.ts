import { prepareTexts } from '../../graph/unlinkedMentions.ts';
import type { PreparedText } from '../../graph/unlinkedMentions.ts';
import type { StoredText } from '../../graph/types.ts';

/** 서랍 칸과 언급 정리가 함께 쓰는 본문 글자. 한 번 불러 찾기용으로 준비해 두고, 지도를 다시 읽으면 버린다. */
export interface TextCache {
  get(titleOf: (id: string) => string | undefined): Promise<PreparedText[]>;
  invalidate(): void;
}

export function createTextCache(load: () => Promise<StoredText[]>): TextCache {
  let texts: Promise<PreparedText[]> | undefined;
  return {
    get(titleOf) {
      const current = (texts ??= load().then((loaded) => prepareTexts(loaded, titleOf)));
      // 실패한 불러오기를 붙잡아 두지 않는다(다음에 다시 시도)
      current.catch(() => {
        if (texts === current) texts = undefined;
      });
      return current;
    },
    invalidate() {
      texts = undefined;
    },
  };
}
