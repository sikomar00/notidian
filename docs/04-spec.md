# 4. Spec (초안 — 승인 대기)

PRD의 F·NF를 어떻게 만들지 정한다. 요구는 [03-prd](./03-prd.md), 화면은 [02-screens-flow](./02-screens-flow.md), 용어는 [GLOSSARY](../GLOSSARY.md), 결정 이유는 [ADR](./adr/)을 본다. 조사 근거는 2026-11-13 공식 문서이며, 문서에 없던 것은 **시험 항목(8절)** 으로 넘겼다.

## 1. 구조

```
src/
├─ graph/       그래프 계산(순수 함수). Chrome도 Notion도 모른다
├─ notion/      Notion API 호출·응답 해석. Notion을 아는 유일한 폴더
└─ extension/   Chrome 쪽: background, options, graph-view, content
qa/             가짜 데이터 점검 페이지
tests/          테스트(`node --test`)
```
의존은 안쪽으로만 간다: **`graph`는 아무것도 가져오지 않는다.** `notion`은 `graph`의 타입만 가져오고, `extension`은 둘 다 가져온다. Notion 요청은 `src/notion/http.ts` 한 곳에서만 보낸다.

**라이브러리**(설치 전 사용자 확인을 한 번 더 받는다. 버전은 설치 때 고정)
`force-graph` 1.52.0, `vite` 8.3.8, `typescript` 7.0.2, `@types/chrome` 0.3.7 — 2026-11-13 npm 조회 값이다.

## 2. 매니페스트

```json
{
  "manifest_version": 3,
  "minimum_chrome_version": "116",
  "permissions": ["storage", "sidePanel", "alarms"],
  "host_permissions": ["https://api.notion.com/*", "https://app.notion.com/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_title": "Notidian 그래프 열기" },
  "options_page": "options.html",
  "side_panel": { "default_path": "graph.html?mode=side" },
  "content_scripts": [{ "matches": ["https://app.notion.com/*"], "js": ["content.js"] }],
  "web_accessible_resources": [{ "resources": ["graph.html"], "matches": ["https://app.notion.com/*"] }]
}
```
- `tabs` 권한은 쓰지 않는다. `action`에 popup을 두지 않는다(두면 아이콘 클릭 이벤트가 안 온다).
- `unlimitedStorage`는 넣지 않는다. 색인 크기를 시험으로 재 본 뒤 필요하면 추가한다.
- `side_panel.default_path`의 쿼리(`?mode=side`)는 패널 안 주소로 그대로 전달되는 것을 확인했다(시험 S-6, Ego Lite).
- 자동 검사: 테스트가 매니페스트의 `host_permissions`가 위 두 개와 정확히 같은지 확인한다(NF-4).

## 3. 저장 데이터 (ERD 대신)

**`chrome.storage.local`** — 작은 설정만 둔다(한도 10MB)
| 키 | 값 |
|---|---|
| `token` | 문자열. 로그와 오류 메시지에 절대 쓰지 않는다 |
| `tokenKind` | `"internal"` \| `"pat"` |
| `viewMode` | `"side"` \| `"center"` \| `"full"` (기본 `side`) |
| `progress` | `{ phase, read, discovered, waitingUntil?, lastError? }` — 화면이 보는 진행 상태. `phase`는 `idle/running/paused/done/error` |

**`chrome.storage.session`** — 브라우저를 닫으면 사라지는 값: `originTabId`, `focusPageId`(아이콘을 누른 순간의 Notion 탭과 그 페이지 ID), `fullTabId`(전체 모드 탭)

**IndexedDB `notidian`** — 색인 본체. **본문 글은 저장하지 않는다**(읽는 동안 메모리에서만 쓰고 버린다)
| 저장소 | 키 | 내용 |
|---|---|---|
| `pages` | `id` | `title`, `kind`(`page`\|`dbItem`), `url`, `lastEdited`(ISO), `parentPageId?`, `status`(`pending`\|`ok`\|`unreadable`), `unreadableReason?`(`forbidden`\|`not-found`\|`not-a-page`\|`error`), `readAt?`(마지막으로 읽은 시각, ISO), `failCount` |
| `links` | `[from, to]` | 방향 있는 연결 하나. `from` 인덱스를 둔다(바뀐 페이지의 옛 연결을 지우려고) |
| `crawl` | `"state"` 한 줄 | `searchCursor?`, `startedAt`, `seenIds`(이번 검색에서 본 ID) |

- 연결 종류(@언급·링크·블록·relation)는 저장하지 않는다. 화면에서 구분하지 않기 때문이다.
- `not-a-page`(데이터베이스 등 페이지가 아닌 대상, 시험 S-7)는 기록만 해 두고 **그래프에 점도 선도 만들지 않는다.**
- 계층 선은 `parentPageId`로 그린다. 부모가 **페이지**인 경우만 센다. 데이터베이스 항목의 부모는 점이 아니고, 블록 안에 든 페이지의 부모는 따로 읽어야 해서 첫 버전에서 뺀다(초안 기본값).
- 색인 삭제(F-7): `pages`·`links`·`crawl`과 `progress`를 비운다. `token`과 `viewMode`는 지우지 않는다.

## 4. Notion 읽기 (`src/notion/`)

모든 요청은 `Authorization: Bearer <token>`과 `Notion-Version: 2026-03-11` 헤더를 쓴다. 이 버전에서는 `archived`가 없고 `in_trash`만 있다.

| 목적 | 요청 | 비고 |
|---|---|---|
| 토큰 검사(F-1) | `GET /v1/users/me` | 401 `unauthorized`면 틀리거나 만료. 만료만 따로 구분하는 코드는 없다 |
| 페이지 목록 | `POST /v1/search` `{filter:{property:"object",value:"page"}, sort:{timestamp:"last_edited_time",direction:"descending"}, page_size:100, start_cursor}` | `has_more`/`next_cursor`로 끝까지. 일부 결과는 `id`만 있는 부분 객체라 `GET /v1/pages/{id}`로 채운다 |
| 페이지 하나 | `GET /v1/pages/{id}` | 읽는 모든 페이지의 속성(relation·제목 속 언급)과 최신 수정 시각을 얻고, 언급으로 발견한 새 페이지의 제목도 얻는다. 그래서 페이지당 요청이 최소 2번이다 |
| 본문 | `GET /v1/blocks/{id}/children?page_size=100` | `has_children`인 블록은 재귀로 다시 부른다. `child_page`는 따라가지 않는다 |
| relation 25개 초과 | `GET /v1/pages/{id}/properties/{property_id}` | `has_more`일 때 `next_cursor`로 반복 |

**허용 요청**: `GET`과 `POST /v1/search`뿐이다. 그 밖(`PATCH`·`DELETE`·다른 `POST`)은 `http.ts`가 보내기 전에 오류를 낸다(NF-5).

**속도**: 한 번에 하나씩, 요청 사이를 350ms 이상 둔다(평균 초당 3회 한도 아래 약 2.9회). 500페이지는 호출 1,000~1,500번으로 추정해 6~9분이다(추정, 실측 아님).

### 연결 찾기 규칙 (순수 함수, 가짜 JSON으로 테스트)
| 어디서 | 규칙 |
|---|---|
| @페이지 언급 | rich_text의 `mention.type="page"` → `mention.page.id` |
| 본문 링크 | `text.link.url`, `href`, `link_mention.href`의 주소에서 페이지 ID를 뽑는다 |
| "페이지로 연결" 블록 | `link_to_page`의 `type="page_id"`만. `database_id`·`comment_id`는 무시 |
| relation 속성 | 페이지 `properties`의 relation 각 항목 `id` |
| 무시 | `child_page`·`child_database`(계층일 뿐 연결이 아님), 자기 자신, 주소의 `#블록` 조각 |

**주소에서 ID 뽑기**: 호스트가 `app.notion.com`, `www.notion.so`, `notion.so` 중 하나이고, 경로 끝의 32자리 16진수를 8-4-4-4-12로 하이픈을 넣어 ID로 쓴다. 그 밖의 호스트와 `?p=` 형태는 첫 버전에서 무시한다. 실제 링크의 호스트·모양은 시험(S-7)으로 확인한다.

**종류 구분**: 부모가 `parent.type="data_source_id"`이면 `dbItem`, 그 밖은 `page`.

## 5. 색인 실행 (`src/extension/background`)

서비스 워커는 이벤트 하나가 5분을 넘으면 종료되고, 30초 동안 활동이 없어도 종료된다. 그래서 **조각으로 나눠 돌린다**.

1. **검색 단계**: 위 `search`로 접근 가능한 모든 페이지를 받는다. 저장된 `lastEdited`와 같으면 `ok` 그대로 두고, 새 페이지이거나 바뀌었으면 `pending`으로 표시한다. 수정 시각은 분 단위로 내림되므로(시험 S-4), 마지막으로 읽은 시각(`readAt`)이 `lastEdited`에서 **2분 이내**였던 페이지는 같아 보여도 `pending`으로 표시한다. 이번에 본 ID를 `seenIds`에 모은다.
2. **읽기 단계**: `pending` 페이지를 하나씩 읽는다. 본문 연결과 relation을 모아, 그 페이지의 옛 연결을 지우고 새 연결을 저장한 뒤 `ok`로 표시한다. 연결 대상이 `pages`에 없는 ID이면 `pending`으로 추가한다(언급을 따라가서 빠진 페이지를 보충).
3. **정리 단계**(다시 색인 때): 이번 검색에 안 나왔고 `unreadable`도 아닌 저장된 페이지는 `GET /v1/pages/{id}`로 확인해, 404이거나 `in_trash`면 지운다. 언급으로만 발견된 페이지가 매번 다시 확인되지만 수가 적을 것으로 본다(추정).
4. **조각 나누기**: 한 번의 실행은 최대 **4분**만 돌고 끝내기 전에 `progress`와 `crawl`을 저장한다. 이어 갈 때는 `chrome.alarms`로 30초 뒤 깨운다. 요청마다 `storage`에 진행을 쓰므로 그 호출이 30초 타이머도 되돌린다.
5. **이어 읽기**: 서비스 워커가 시작될 때 `phase="running"`이면 이어서 돈다. "중단"은 `phase="paused"`로 바꾸는 것이다. 어느 지점에서 끊어도 `pages.status`와 `searchCursor`로 이어진다(NF-7).

검색 색인은 수십 초 늦게 반영될 수 있다(시험 S-2: 새 페이지 1개가 15초 뒤에 나옴). 설정 화면의 "다시 색인" 옆에 "방금 고친 내용은 잠시 뒤에 보일 수 있습니다"를 안내한다.

**오류 처리**
| 상황 | 동작 |
|---|---|
| 401 | `progress.phase="error"`, 설정 화면에 "토큰이 틀리거나 만료됐다" 표시(F-8) |
| 429 | `Retry-After`초(최대 60) 기다렸다 같은 요청을 다시 한다. `waitingUntil`을 저장해 "잠시 대기 중"을 보여 준다. 연속 5번 실패하면 `paused`로 멈춘다 |
| 403·404, 부분 객체 조회 실패 | 그 페이지를 `unreadable`로 표시하고 계속한다(F-5) |
| 400 `validation_error`(데이터베이스 ID를 페이지로 읽음, 시험 S-7에서 확인) | `unreadable`(`not-a-page`)로 표시하고 이 대상과 그 연결을 그래프에서 뺀다. 데이터베이스는 점이 아니다 |
| 5xx·네트워크 오류 | 3번까지 점점 길게 기다린다. 그래도 안 되면 `failCount`를 올리고 `pending`으로 둔다. 3번 넘게 실패한 페이지는 `unreadable`로 바꾼다 |

## 6. 화면 구현 (`src/extension`)

**그래프 화면은 `graph.html` 하나**이고 `?mode=side|center|full`로 컨테이너만 다르다.

**아이콘 클릭(F-14, F-13)** — `action.onClicked`에서 분기한다.
- 사이드 패널은 사용자 동작 안에서 **바로** 열어야 해서, 클릭 처리 안에서 저장소를 기다리지 않는다. 그래서 `viewMode`와 `ready`(토큰·색인이 있는지)를 **메모리에 미리 올려 두고** 바로 분기한다.
- `ready`가 아니면 `chrome.runtime.openOptionsPage()`.
- `side`: `chrome.sidePanel.open({windowId})`. `openPanelOnActionClick`은 `false`로 명시한다.
- `center`: 지금 탭의 content script에 "토글" 메시지를 보낸다. content script는 `graph.html?mode=center`를 담은 iframe을 80% 크기로 띄우고, 바깥 클릭·Esc·아이콘 재클릭으로 닫는다. iframe 안에서 Esc를 누르면 `chrome.runtime.sendMessage` → background → 해당 탭 content script 순으로 닫는다.
- `full`: 저장된 `fullTabId`가 있고 탭이 살아 있으면 그 탭을 앞으로 가져오고, 아니면 `chrome.tabs.create`로 새 탭을 만든다. 탭이 닫히면 `fullTabId`를 지운다(`tabs` 권한 없이 가능).
- 서비스 워커가 막 깨어난 직후라 캐시가 비어 있으면 저장소를 읽은 뒤 분기한다. 이때 사이드 패널이 사용자 동작으로 인정되지 않을 수 있어, 실패하면 전체 모드로 대신 연다(시험 S-6).

**현재 페이지 인식(F-10)**: 클릭한 순간 `tab.url`(호스트 권한 덕에 읽힌다)에서 ID를 뽑아 `storage.session.focusPageId`에 둔다. 그래프는 그 점을 강조하고 가운데로 옮긴다. 색인에 없으면 강조하지 않는다.

**점 클릭(F-9)**: `side`·`center`는 클릭 시점의 활성 탭이 `app.notion.com`이면 그 탭을 `tabs.update`로 이동시키고, 아니면 새 탭으로 연다. `center`는 이동 뒤 창을 닫는다. `full`은 항상 새 탭이다.

**모드 전환(S2-1)**: 버튼 클릭이 사용자 동작이라 사이드 패널을 열 수 있다. `viewMode`를 저장하고, 현재 컨테이너를 닫은 뒤 새 컨테이너를 연다.

**그리기(`force-graph`)**
- 크기: `force-graph`는 만들 때의 크기만 쓰고 자동으로 맞추지 않는다. 사이드 패널은 처음 크기가 0이었다(시험 S-6). 컨테이너 크기가 0보다 커진 뒤에 만들고 `ResizeObserver`로 크기를 맞춘다.
- 점: `nodeCanvasObject`로 그린다. 일반 페이지는 원, 데이터베이스 항목은 네모, 읽을 수 없는 페이지는 회색. `nodePointerAreaPaint`도 같은 모양으로 그려야 클릭 영역이 맞는다. 크기는 `연결 수`의 제곱근에 비례한다.
- 연결: 평소엔 화살표 없는 얇은 선. 점에 올리면 `onNodeHover`로 이웃 `Set`을 만들어 그 점의 선만 강조하고 `linkDirectionalArrowLength`를 함수로 주어 강조된 선에만 화살표를 낸다. `autoPauseRedraw(false)`로 호버 재그리기를 보장한다. 양쪽으로 이어진 선은 화살표 양쪽.
- 가운데 맞추기: `centerAt`, `zoom`. 시뮬레이션이 안정되기 전에는 좌표가 없으므로, 안정된 뒤에 맞춘다.
- 색 테마: `prefers-color-scheme`. 색 값은 Plan에서 정하고, 대비(NF-3)는 테스트가 계산한다.
- 검색(F-11): 색인의 제목에서 대소문자 무시 부분 일치. ARIA combobox, 방향키·Enter.
- 계층 스위치(F-12): `parentPageId` 선을 더하거나 뺀다. 기억하지 않고 매번 꺼짐으로 시작한다(초안 기본값).
- `S2-4` 상태 한 줄은 `storage.onChanged`로 `progress`를 따라간다. 색인이 진행 중이면 `pages`를 읽어 부분 그래프를 그린다(F-15).

**그래프 계산 (`src/graph`, 순수 함수)**
- `mergeLinks(rawLinks)`: 자기 자신 제거, 같은 쌍 하나로 합침, A→B와 B→A는 양쪽 화살표 한 선(F-4).
- `buildGraph(pages, links, {hierarchy})`: 점·선 목록과 연결 수, 읽을 수 없는 페이지 점 처리(F-5).
- `searchTitles(pages, query)`.

## 7. 테스트 계획 (`node --test`, 타입 스트리핑)

| 대상 | 방법 | PRD |
|---|---|---|
| 연결 찾기 | 종류별 가짜 JSON(언급·링크·`link_to_page`·relation 25개 초과·중첩 블록) | F-3 |
| 연결 합치기·계층 | 순수 함수 입출력 | F-4, F-12 |
| 주소→ID | 호스트별·하이픈·`#조각` | F-3 |
| 바뀐 페이지 판정·정리 단계 | 가짜 Notion(메모리 안의 응답)으로 두 번 색인 | F-6 |
| 이어 읽기 | 가짜 Notion으로 중간에 끊고 이어 읽은 결과 = 한 번에 읽은 결과 | NF-7, F-2 |
| 오류 처리 | 가짜 응답으로 401·429·403·404·5xx | F-8, F-5 |
| 허용 요청 | `http.ts`가 `PATCH`·`DELETE`·다른 `POST`를 거부 | NF-5 |
| 토큰 비노출 | 모든 오류·로그에 토큰 문자열이 없음을 검사 | NF-4 |
| 매니페스트 | `host_permissions`가 정확히 두 개 | NF-4 |
| 색 대비 | 대비 계산 함수로 4.5:1·3:1 | NF-3 |
| 그래프 열림 시간 | `qa/` 점검 페이지에서 가짜 500·2,000 점 | NF-1 |

화면(`qa/`)은 가짜 데이터만 쓴다. 실제 토큰과 Notion 데이터는 사람 QA로 넘긴다.

## 8. 시험(Spike) — Plan의 첫 작업, 이 순서로

실패하면 **구현을 멈추고** 원인과 대안을 사용자에게 보고한다. 대안은 제가 정하지 않고, 비공식 내부 API로는 넘어가지 않는다.

| ID | 시험 | 성공이면 |
|---|---|---|
| S-1 | 서비스 워커에서 `GET /v1/users/me`를 내부 통합 토큰으로 호출(`Authorization`·`Notion-Version` 헤더 포함) | CORS 문제 없음 → ADR 0001 시험 한 가지 통과 |
| S-2 | 내부 통합 토큰을 읽기만 켜서 만들 수 있나, 상위 페이지를 연결하면 하위 페이지와 데이터베이스 항목이 검색에 나오나 | ADR 0001 `accepted` |
| S-3 | 50페이지를 실제로 읽는 시간 → 500페이지 시간 다시 계산 | NF-1의 10분이 맞는지 판정 |
| S-4 | 본문을 고치면 그 페이지의 `last_edited_time`이 바뀌나, 언급된 페이지 이름을 바꾸면 참조한 쪽이 바뀌나 | F-6(바뀐 것만 읽기) 설계 확정. 안 바뀌면 "전체 다시 읽기"로 바꾼다 |
| S-5 | `app.notion.com`에서 iframe 오버레이가 뜨나(CSP), 확장 페이지에서 `force-graph`가 CSP 오류 없이 도나 | 중앙 모드·그래프 화면 확정 |
| S-6 | `onClicked`에서 메모리 캐시로 `sidePanel.open()`이 되나, 콜드 스타트 폴백이 되나, `side_panel.default_path`에 쿼리가 되나 | 아이콘 분기 확정 |
| S-7 | 내 Notion의 본문 링크 호스트·모양(`app.notion.com`/`notion.so`/`?p=`), 데이터베이스를 가리키는 링크의 응답 | 연결 찾기 규칙 확정 |
| S-8 | 가짜 2,000 점 그래프의 실제 그리기 성능 | NF-1의 10초 판정 |

## 9. 초안 기본값 — 인터뷰에서 따로 묻지 않은 것
승인하시면 확정된다. 바꾸고 싶으면 알려 주세요.
- 계층 선은 부모가 페이지인 경우만 그린다.
- 계층 스위치는 기억하지 않고 매번 꺼짐으로 시작한다.
- 요청은 한 번에 하나, 350ms 간격으로 한다.
- 한 번의 실행은 4분까지, 이어 갈 때 30초 뒤 알람으로 깨운다.
- 연속 429 5번이면 멈추고, 5xx는 3번 시도한다.
- 이번 검색에 안 나온 저장 페이지는 개별 확인해서 삭제를 반영한다.

시험 결과로 바뀐 것(2026-11-13, 사용자 "진행"으로 반영): 데이터베이스를 가리키는 연결은 그래프에서 뺀다, 수정 시각에서 2분 이내에 읽은 페이지는 다음 색인에서 다시 읽는다, 검색 지연을 설정 화면에 안내한다, 사이드 패널은 크기가 생긴 뒤에 그래프를 만든다.

## 10. 확인하지 못한 것
시험 항목(8절)과 같다. 특히 S-2(내부 통합 토큰의 읽기 전용·연결 범위)와 S-4(수정 시각 갱신)는 결과에 따라 이 Spec의 일부를 고쳐야 한다. 서비스 워커에서 `fetch` 응답이 30초 타이머를 되돌리는지는 문서에서 확인하지 못해, 위 4분 조각과 `storage` 쓰기 방식으로 안전하게 설계했다.
