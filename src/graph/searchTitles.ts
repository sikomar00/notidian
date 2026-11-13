const normalize = (text: string): string => text.normalize('NFC').toLowerCase().trim();

/** 제목 부분 일치 검색(대소문자 무시). 앞에서 시작하는 제목을 먼저, 그다음 포함하는 제목을 보여 준다. */
export function searchTitles<T extends { title: string }>(items: readonly T[], query: string, limit = 20): T[] {
  const needle = normalize(query);
  if (needle === '') return [];
  const starts: T[] = [];
  const contains: T[] = [];
  for (const item of items) {
    const title = normalize(item.title);
    if (title.startsWith(needle)) starts.push(item);
    else if (title.includes(needle)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, limit);
}
