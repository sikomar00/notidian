---
status: accepted
---
# 모든 처리는 브라우저 안에서만 하고 서버를 두지 않는다

Notion 내용과 토큰은 개인 데이터라서, 외부 서버·통계 수집 없이 토큰과 색인을 브라우저 저장소에만 둔다. 확장 권한은 `app.notion.com`(사용자가 쓰는 Notion 웹앱 주소)과 `api.notion.com` 두 곳으로 제한한다. 토큰은 `chrome.storage.local`에 암호화 없이 저장되어 같은 Windows 계정의 다른 프로그램이 읽을 수 있다. 첫 버전은 이 한계를 받아들이고, 읽기 전용 토큰을 쓰는 것과 설정 화면 안내로 줄인다.

## Considered Options
- **자체 서버에서 OAuth 로그인:** 사용자가 토큰을 직접 만들 필요가 없지만, Notion OAuth는 client secret이 있는 서버가 필요하고 내 Notion 내용이 서버를 거치게 된다.

## Consequences
- OAuth를 쓰지 않으므로 사용자가 토큰을 직접 만들어 설정 화면에 넣어야 한다. 지금은 나 혼자 쓰니 괜찮지만, 공개 배포를 하게 되면 사용 장벽이 된다. 그때 이 결정을 다시 본다.
