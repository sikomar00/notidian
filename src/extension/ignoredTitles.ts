// 언급 정리에서 "이 제목은 빼기"로 뺀 제목(비교용 NFC·소문자 글자). 이 브라우저에만 두고, 저장된 데이터 지우기로 함께 지운다(F-25, NF-14)
export const IGNORED_KEY = 'ignoredMentionTitles';

export async function loadIgnored(): Promise<Set<string>> {
  return ignoredFrom((await chrome.storage.local.get(IGNORED_KEY))[IGNORED_KEY]);
}

/** 제목 하나를 빼거나 다시 넣는다. 다른 Notidian 화면에서 바꾼 것을 덮어쓰지 않게 저장된 값을 읽어 고친다. */
export async function updateIgnored(title: string, ignore: boolean): Promise<void> {
  const titles = await loadIgnored();
  if (ignore) titles.add(title);
  else titles.delete(title);
  await chrome.storage.local.set({ [IGNORED_KEY]: [...titles] });
}

/** 저장소 변경 값에서 뺀 제목을 읽는다(다른 화면에서 바꿨거나 저장된 데이터를 지웠을 때). */
export function ignoredFrom(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
}
