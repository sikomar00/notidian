# 9. 연결 안 된 언급 — Spec (승인 2026-11-14)

요구는 [08 PRD](./08-unlinked-mentions-prd.md)(F-16~F-22, NF-8~NF-12), 화면은 [07](./07-unlinked-mentions-screens.md)(S2-7, UJ-6~7), 결정은 [ADR 0004](./adr/0004-store-body-text.md)를 본다. 첫 기능의 Spec은 [04](./04-spec.md)이고, 여기서는 바뀌는 것만 적는다.

## 1. 구조 — 바뀌는 곳
의존은 지금처럼 바깥(Notion·Chrome·화면) → 안쪽(순수 함수)으로만 둔다. 새 파일 셋, 고치는 파일 몇 곳이다.

| 파일 | 할 일 | 종류 |
|---|---|---|
| `src/notion/extractText.ts` (새) | 블록 JSON → 글자. Notion 응답 모양을 아는 곳은 `src/notion/`뿐이다 | 순수(경계 해석) |
| `src/graph/unlinkedMentions.ts` (새) | 제목·글자·연결 → 연결 안 된 언급 목록 | 순수 |
| `src/extension/graph-view/mentionsPanel.ts` (새) | S2-7 칸 그리기 | 화면 |
| `src/extension/background/crawl.ts` | 읽은 블록에서 연결과 함께 글자도 뽑아 저장, 글자 없는 페이지 다시 읽기 | 색인 |
| `src/extension/background/idbStore.ts`, `types.ts` | `texts` 저장소, 버전 2 올리기 | 저장 |
| `src/graph/types.ts` | `PageRecord.textVersion?` | 타입 |
| `src/graph/demoData.ts` | 가짜 본문 | 예시 |
| `graph.html`, `graph-view/main.ts` | 서랍에 칸 추가, 글자 불러오기 연결 | 화면 |
| `graph-view/statusLine.ts` | 첫 전체 다시 읽기 안내 | 화면 |

## 2. 저장 데이터 — 바뀌는 곳

**IndexedDB `notidian` 버전 1 → 2**
| 저장소 | 키 | 내용 |
|---|---|---|
| `texts` (새) | `id`(페이지 ID) | `{ id, text }`. 블록마다 한 줄(`\n`으로 이음), 최대 10만 자(NF-9) |
| `pages` | `id` | 필드 하나 추가: `textVersion?: number` — 이 규칙 버전으로 글자를 모았는지 |

- 글자를 `pages`에 넣지 않고 따로 두는 이유: 그래프 화면은 다시 그릴 때마다 `pages`를 통째로 읽는다. 몇 MB의 글자가 거기 섞이면 그래프가 늦게 열린다.
- 버전 올리기: `onupgradeneeded`에서 `oldVersion < 1`이면 지금의 세 저장소를, `oldVersion < 2`이면 `texts`를 만든다. 기존 지도는 지우지 않는다.
- `deletePage`는 `texts`의 같은 ID도 지우고, `clear`(저장된 데이터 지우기)는 `texts`도 비운다.
- `TEXT_VERSION = 1`(코드 상수). 나중에 모으는 블록 종류를 바꾸면 숫자를 올려서 다시 모으게 한다.

`IndexStore`에 더하는 것:
```ts
putText(id: string, text: string): Promise<void>;
listTexts(): Promise<{ id: string; text: string }[]>;
```

## 3. 글자 모으기 (F-16·F-17, `src/notion/extractText.ts`)
- 모으는 블록: `paragraph`, `heading_1~3`, `bulleted_list_item`, `numbered_list_item`, `to_do`, `toggle`, `quote`, `callout`의 `rich_text`, `table_row`의 칸(칸 사이는 공백).
- `rich_text` 안에서 `mention`(@언급) 항목은 빼고 `text`·`equation` 항목의 `plain_text`만 쓴다. @언급의 글자는 대상 페이지 제목이라, 넣으면 "회의록 2024"를 언급한 곳이 "회의록"의 연결 안 된 언급으로 잘못 잡힌다.
- 빼는 블록: `code`, `child_page`, `child_database`(하위 페이지 글자는 그 페이지 몫), 그 밖의 종류.
- 블록 순서: 지금의 블록 읽기(`readBlockTree`)는 하위 블록을 나중에 읽어서 글자 순서가 문서 순서와 조금 다를 수 있다. 찾기는 블록 하나 안에서만 하므로 결과에는 영향이 없다.
- `crawl.ts`의 `collectTargets`가 같은 블록 목록에서 연결과 글자를 함께 돌려준다. 요청이 늘지 않는다(NF-11).
- `readOne`은 `putText` → `putPage({..., textVersion: TEXT_VERSION})` 순서로 저장한다. 중간에 끊기면 `textVersion`이 없어 다음에 다시 읽는다.
- 읽을 수 없게 된 페이지는 글자를 지운다.
- **다시 읽기 판단(`needsRead`)**: 지금 규칙에 "`status`가 `ok`인데 `textVersion !== TEXT_VERSION`이면 읽기"를 더한다. 그래서 업데이트 뒤 첫 다시 만들기는 전체를 읽는다.
- **상태 줄 안내**: 색인을 시작할 때 `ok`인데 `textVersion`이 없는 페이지가 있으면 `progress.collectingText = true`를 둔다. 상태 줄은 이때 "본문을 처음 모으느라 이번엔 전체를 다시 읽어요"를 덧붙인다. 다 끝나면 지운다.

## 4. 찾기 (F-18·F-19, `src/graph/unlinkedMentions.ts`)
```ts
interface Mention { id: string; count: number; before: string; match: string; after: string }
function prepareTexts(texts: { id; text }[], titleOf): PreparedText[]   // 불러올 때 한 번(NFC·소문자 줄)
function findUnlinkedMentions(
  target: { id: string; title: string },
  pages: readonly PreparedText[],
  linkedFrom: ReadonlySet<string>,   // 이미 target으로 연결이 있는 페이지
): Mention[] | 'too-short'
```
- 제목·글자 모두 `normalize('NFC')` 후 `toLowerCase()`로 비교한다. 대소문자를 바꿔도 글자 수가 같은 경우만 앞뒤 문장 위치가 맞는다(터키어 İ 등은 어긋날 수 있다 — `shortcut:` 주석으로 남긴다).
- 제목 앞뒤 정리(공백), 2글자 이하·"제목 없음"이면 `'too-short'`.
- 경계: 제목의 첫 글자가 라틴 문자·숫자(`/[\p{Script=Latin}\p{N}]/u`)이면 바로 앞 글자가 라틴 문자·숫자가 아니어야 한다. 끝 글자도 같다. 한글 쪽은 경계를 보지 않는다.
- 블록 경계(`\n`)를 넘어 찾지 않는다. 제목에 줄바꿈이 없으니 `indexOf`로 충분하다.
- 빼는 것: 자기 자신, `linkedFrom`에 있는 페이지. `linkedFrom`은 저장된 연결(`links`)에서 `to === target.id`인 `from`이다(계층은 연결이 아니라 빼지 않는다).
- 앞뒤 문장: 처음 나온 곳의 앞 30자·뒤 30자를 원래 글자에서 자른다(같은 블록 안에서만). 잘렸으면 "…"를 붙인다.
- 정렬: `count` 많은 순 → 제목 순. 화면이 앞의 50개만 그린다.

## 5. 화면 (S2-7, F-19~F-22)
- `graph.html` 서랍의 `.links`에 세 번째 `<section aria-labelledby="mention-title">`을 더한다. 제목 `<h2>`, 설명 `<p class="hint">`, `<ul id="sel-mentions">`, 상태 문구 `<p id="mentions-note">`.
- 줄은 `<li><button>`이고 안에 제목(`<strong>` 아님, 보통 굵기), 앞뒤 문장(찾은 글자만 `<strong>`), "N곳". 누르면 `openById(id)`(점 클릭과 같은 규칙, F-20).
- 글자 불러오기: 처음 페이지를 고를 때 `store.listTexts()`를 한 번 불러 메모리에 둔다. 지도가 다시 그려질 때(`reloader`가 새 데이터를 넘길 때) 버린다. 예시 모드는 `demoData().texts`를 쓴다.
- 상태 문구(07 문서 3절): 글자 있는 페이지가 하나도 없으면 "다시 만들기를 하면 보여요", `progress.phase === 'running'`이면 결과 + "연결 지도를 만드는 중이라 더 나올 수 있어요", 결과 0이면 "글자로만 적은 곳이 없어요", `'too-short'`면 "제목이 너무 짧아서 찾지 않아요", 읽을 수 없는 페이지면 칸을 숨긴다.
- 그래프 렌더러·목록 보기·CSV는 바꾸지 않는다.

## 6. 테스트 계획
- 단위(`node --test`): `extractText`(블록 종류별, @언급 빼기, 표 칸, 코드 빼기, 10만 자 자르기), `findUnlinkedMentions`(한글 조사, 라틴 경계 "art"/"start", 섞인 제목 "Q4 회의", 대소문자, 자기 자신·이미 연결·짧은 제목·"제목 없음", 블록 경계, 앞뒤 문장 "…", 정렬), 색인(글자 저장, `textVersion` 없는 페이지 한 번 다시 읽기 후 안 읽기, 가짜 Notion 요청 기록이 기능 전과 같음, 페이지 삭제·읽을 수 없음에서 글자 지움, `clear`).
- 자동 화면 점검(`npm run qa:e2e`, 예시 모드): 칸 제목과 개수, 굵은 글자, 짧은 제목 안내, 결과 누르면 열기 시도, 키보드 Tab·Enter, 360px 폭에서 아래로 쌓임.
- 속도(NF-8): `qa/`에 가짜 500·2,000페이지 × 3,000자로 `findUnlinkedMentions` 시간을 재는 스크립트.
- 사람(H): IndexedDB 버전 1인 기존 지도에서 업데이트 → 지도가 남아 있고 첫 다시 만들기가 전체를 읽는지, NF-9 실제 저장 크기, NF-12 품질.

## 7. 초안 기본값 — 따로 묻지 않은 것
- 글자는 그래프 화면에서 계산한다(서비스 워커가 미리 계산해 두지 않는다). 제목이 바뀌거나 새 페이지가 생겨도 바로 맞고, 계산은 짐작으로 2,000페이지에서도 수십 ms다.
- `equation`(수식) 글자는 넣는다. 수식 안에 제목이 있을 일은 드물지만 빼는 코드가 더 길다.
- 하위 블록이 있는 `synced_block`·`column` 등 감싸는 블록은 자기 글자는 없고 안쪽 블록이 각각 모인다(지금 블록 읽기 규칙 그대로).

## 8. 확인하지 못한 것
- IndexedDB 버전 2로 올릴 때 실제 Chrome에서 기존 지도가 남는지(자동 점검은 새 프로필이라 못 본다 → H).
- `listTexts()`로 10MB를 한 번에 읽는 시간(NF-8에 들어가지 않는 첫 불러오기 시간).
- Notion `rich_text` 항목 중 `text`·`mention`·`equation` 말고 다른 종류가 있는지(문서상 세 가지로 알고 있다).
