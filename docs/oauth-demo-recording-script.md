# 모아 캘린더 OAuth 데모 촬영 대본

목표 길이: 약 3~4분. 아래 시간은 편집·진행 참고용이며 실제 인증과 가져오기가 끝날 때까지 충분히 보여줍니다. 앱과 Google 동의 화면은 영어로 설정합니다. 제출 전 앱 권한·정책 불일치 해결 항목은 `google-oauth-verification.md`를 따릅니다.

## 촬영 준비

2026-10-14 준비 상태: 실제 Google 권한 연결과 샘플 일정 1건 가져오기를 확인했습니다. 모아의 `OAuth Demo` 캘린더는 참여자 1명이며 영문 UI로 준비했습니다. Google 원본 샘플은 2026-10-13 21:30–22:30 KST, 설명은 `Sample event for Google OAuth verification. No personal information.`입니다. 기존 `oauth-demo-original.mov`는 정지 화면 위주라 제출용이 아닙니다. 새 화면 녹화 시작은 macOS 제어창 응답 문제로 사용자가 직접 진행해야 합니다.

- 개인 일정이 없는 테스트용 Google 계정과 모아 캘린더를 사용합니다.
- Google 기본 캘린더에 `OAuth Demo Meeting`이라는 가상 일정을 만듭니다. 설명은 `Sample event for OAuth verification.`로 설정합니다. 가져오기 기간 안의 날짜로 지정합니다.
- Google 로그인 사용자도 추가 캘린더 권한을 연결할 수 있는지, 실제 요청 scope와 콘솔 등록 scope가 같은지 리허설로 확인합니다.
- 브라우저 주소창이 보이게 하고 알림 및 관련 없는 창을 정리합니다.
- Mac에서 `Shift + Command + 5`를 눌러 화면 녹화 도구를 엽니다. '선택 부분 기록'으로 브라우저와 주소창을 포함한 영역을 정합니다. 옵션에서 저장 위치를 선택합니다.
- 비밀번호 입력은 촬영을 일시 중단하거나 해당 부분을 최종 영상에서 제거합니다. 클라이언트 secret이나 토큰은 보여주지 않습니다.

## 장면별 대본

| 예상 시간 | 화면 조작 | 영문 내레이션 또는 자막 |
| --- | --- | --- |
| 0:00–0:25 | 영어 공개 홈페이지 https://dwm.brightnetworks.kr/en/ 및 개인정보처리방침 링크 표시 | This is Moa Calendar, a web-based shared calendar service. Users can create calendars, invite members, and manage schedules together. Our privacy policy is accessible from the homepage. |
| 0:25–1:00 | Google 로그인 버튼부터 로그인 완료까지 표시 | First, I sign in with Google. Basic sign-in uses the OpenID scope to identify my account. Google Calendar access is requested separately for the optional import feature. |
| 1:00–1:50 | 테스트 캘린더 선택 → Google 캘린더 권한 연결 → 영어 동의 화면 → 완료 | I now enable Google Calendar import. The consent screen shows the app name and the requested read-only event permission. The browser address bar identifies the OAuth client used by this app. |
| 1:50–2:15 | Google 캘린더의 가상 일정 제목·시작/종료·설명 표시 | This is a sample event in my primary Google calendar. It has a title, a start and end time, and a description. |
| 2:15–3:00 | 새 모아 캘린더 이름·기간 선택 → 공유 안내 확인 → 새 캘린더 만들고 가져오기 → 결과 표시 | I name a new Moa calendar and choose the date range. Moa creates that separate calendar and imports the events into it. Members I invite later can view the imported events. Here is an imported event with its title, time, and description. |
| 3:00–3:30 | Google 원본 일정 유지 확인, 구현된 연결 해제/삭제 방법 표시 | Moa reads and copies Google events when I request an import. It does not create, modify, or delete the original events in Google Calendar. |

연결 해제와 삭제는 구현된 실제 기능만 보여줍니다. Google 계정의 권한 철회와 모아 DB의 토큰/일정 삭제를 같은 동작이라고 설명하지 마세요. 현재 구현에 없는 연동 해제나 자동 삭제를 시연했다고 말하지 않습니다.

## 녹화 종료와 검수

Mac 메뉴 막대의 녹화 중지 버튼으로 종료합니다. QuickTime에서 처음부터 끝까지 재생하여 다음을 확인합니다.

1. 앱 이름이 읽히고 Google 로그인 및 캘린더 동의 흐름이 실제 화면으로 보입니다.
2. OAuth 동의 화면의 주소창에서 client_id를 식별할 수 있습니다.
3. 최종 제출 scope와 영상 속 요청 권한이 일치합니다.
4. 가져오기 조작과 실제 표시 결과가 모두 보입니다.
5. 비밀번호, OAuth code/token, client secret, 실제 개인 일정이 노출되지 않습니다.
6. 전체 화면 흐름과 결과가 이해되도록 유지합니다. 필요한 가림/잘라내기 외에 동작을 연출하거나 결과를 합성하지 않습니다.

저장 파일 예: `moa-oauth-verification.mov`. 검수 후 YouTube Studio에 일부 공개(Unlisted)로 업로드하고 링크로 재생 가능한지 확인합니다. 업로드와 Google 제출은 별도 단계입니다.

공식 기준: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
