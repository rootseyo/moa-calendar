# 모아 캘린더 Google OAuth 검토 준비

확인일: 2026-10-14. 아래 수정 사항은 운영 서비스에 배포했습니다. 실제 녹화 영상에 영문 자막을 넣은 검토용 파일을 준비했습니다. YouTube 업로드와 심사 제출은 아직 완료하지 않았습니다.

## 현재 반영 결과

- Google 기본 로그인은 `openid`, 선택적 캘린더 연결은 `calendar.events.readonly`로 분리했습니다.
- Google 로그인 사용자에게도 별도 캘린더 권한 연결 버튼을 제공합니다. 사용자 ID의 콜론 분리 오류도 수정했습니다.
- 발급된 scope를 확인하며, 일반 로그인은 기존 캘린더 권한을 덮어쓰지 않습니다.
- Google 토큰을 AES-256-GCM으로 암호화합니다. 기존 운영 Google 계정 2개의 저장 토큰도 암호화했으며, 암호화되지 않은 Google 토큰은 0개입니다. 기존 scope가 기록되지 않은 연결은 재동의가 필요합니다.
- 연결 해제는 서비스 토큰을 삭제하고 Google 권한 철회를 요청합니다. 철회 요청 실패 시 사용자에게 Google 계정 설정에서 직접 철회하도록 안내합니다. 늦게 도착한 갱신/콜백이 연결을 복구하지 않도록 차단합니다.
- Google 캘린더 가져오기는 새 Moa 캘린더를 자동으로 만들고 그곳에 일정을 복사합니다. 기존 캘린더를 선택하거나 연결하지 않으며, 새 캘린더 이름과 가져올 기간을 사용자가 정합니다.
- 가져온 일정은 새 캘린더에 저장되고 나중에 초대되는 참여자에게 보인다는 안내를 확인받습니다. 서버도 동의 여부를 확인하며, 캘린더 생성과 일정 저장은 한 번의 트랜잭션으로 처리합니다.
- 개인정보처리방침과 약관을 실제 저장·공유·삭제 동작에 맞췄습니다. 자동 탈퇴·캘린더 전체 삭제를 제공한다는 잘못된 설명도 제거했습니다.
- 콘솔 데이터 액세스에 `openid`와 `calendar.events.readonly`, 영문 권한 사용 사유를 저장했습니다. 일정 읽기 권한은 여전히 **승인 필요** 상태입니다.
- 사용자가 Google Calendar API를 활성화했고 콘솔에서 상태 '사용 설정됨'을 확인했습니다.
- 13개 테스트가 별도 `share_schedule_test_db`에서 통과했습니다. 암호화, 권한 거절, 정상 갱신, 공유 동의 및 해제 중 동시 요청을 포함합니다.
- 사용자 승인 후 실제 Google 연결을 완료하고 Google Calendar API에서 샘플 일정 1건을 가져왔습니다. 혼자 참여한 `OAuth Demo` 캘린더에서 제목 `OAuth Demo Meeting`, 시간 2026-10-13 21:30–22:30 KST, 설명 `Sample event for Google OAuth verification. No personal information.`의 표시를 확인했습니다.
- 기존 화면 기록(133.29초)은 Google 캘린더 정지 화면 위주로 로그인·동의·가져오기 시연이 없어 제출용으로 사용할 수 없습니다. macOS 화면 기록 제어창이 자동화에 응답하지 않아 녹화 시작을 사용자에게 인계합니다.
- 사용자가 제공한 `/Users/sean/Documents/GOOGLE.mov`에서 실제 로그인·영문 캘린더 동의·가져오기 장면을 확인했습니다. 약 1분 52초의 1080p 영문 자막 편집본 `moa-google-oauth-verification-en.mp4`와 SRT를 만들었습니다. 녹화 중 생성한 `OAuth Review Demo` 캘린더에 샘플 일정 1건을 가져왔습니다. 영상 상세 점검과 업로드 설명은 `oauth-video-review/README.md`에 있습니다.
- 운영 사용자 5명, 캘린더 2개, 일정 18개를 유지했습니다. 코드·설정·DB 백업은 서버의 `/home/sean/services/share-schedule-backups/oauth-20261013-195014`에 있습니다.

아래 초기 점검 결과는 수정 전 발견한 문제를 기록한 것입니다.

## 1. 초기 콘솔 상태 (수정 전)

| 항목 | 확인 결과 |
| --- | --- |
| 프로젝트 | `gen-lang-client-0221943018` (bright project) |
| 앱 이름 | 모아 캘린더 |
| OAuth 웹 클라이언트 | `784999823091-splrahea4tsgo14t5v2gr4mq50aj6acr.apps.googleusercontent.com` |
| 사용자 유형 / 게시 | 외부 / 프로덕션 |
| 브랜딩 | 인증 완료, 사용자에게 표시 중 |
| 데이터 액세스 | 비민감·민감·제한 범위 모두 등록된 행 없음 |
| 인증 센터 | 등록된 민감 범위가 없어 데이터 액세스 인증이 필요하지 않다고 표시 |
| 미승인 권한 사용자 수 | 100명 중 3명 |
| 홈페이지 | https://dwm.brightnetworks.kr/ |
| 개인정보처리방침 | https://dwm.brightnetworks.kr/privacy → /privacy.html |
| 이용약관 | https://dwm.brightnetworks.kr/terms |
| 승인된 도메인 | brightnetworks.kr |
| 지원 / 개발자 연락처 | root.seyo@gmail.com |
| 검토용 영상 | 아직 없음 (사용자 확인) |

브랜딩 인증 완료는 캘린더 권한 승인 완료를 의미하지 않습니다. 등록 범위가 비어 있는 현재 화면을 캘린더 API 심사 통과의 증거로 사용하면 안 됩니다. Search Console 소유권과 Calendar API 사용 설정 여부는 이번 확인에서 독립적으로 검증하지 않았습니다.

## 2. 기능과 최소 권한

`server.mjs`의 일반 Google 로그인은 `openid`만 요청합니다. 수정 후 캘린더 연결 흐름은 `openid https://www.googleapis.com/auth/calendar.events.readonly`를 요청하고 `access_type=offline`, `prompt=consent`를 사용합니다.

캘린더 기능은 `GET /calendar/v3/calendars/primary/events`로 본인의 기본 Google 캘린더 일정을 읽어, 선택한 모아 공유 캘린더에 제목·시작/종료·설명을 복사합니다. Google 일정 생성·수정·삭제나 양방향/백그라운드 동기화는 구현되어 있지 않습니다.

코드 및 콘솔에 반영한 제출 범위는 다음과 같습니다.

| 범위 | 용도 |
| --- | --- |
| `openid` | Google 계정 고유 식별자로 로그인 |
| `https://www.googleapis.com/auth/calendar.events.readonly` | Google 일정 읽기 및 가져오기 |

Google의 events.list 문서에서 `calendar.events.readonly`를 지원합니다. 기존 `calendar.readonly`보다 좁은 권한으로 변경했습니다. 새 동의로 실제 Google API 가져오기를 검증해야 합니다. 본인 소유 일정만 필요하다면 더 좁은 `calendar.events.owned.readonly`도 검토할 수 있습니다. 초대받은 일정까지 포함하는 서비스 요구를 확인한 후 최종 선택하세요.

## 3. 초기 불일치 및 수정 내용

| 공개 설명 / 현재 동작 | 필요한 조치 |
| --- | --- |
| OpenID sub를 '익명화된 식별자'라고 표현 | sub는 계정 식별자이므로 익명화라는 표현 삭제 |
| 권한을 일시 사용한다고 설명하지만 access/refresh token을 DB에 보관하고 갱신 | 지속 보관 목적·보유 기간·철회/삭제 방법을 실제 구현과 일치시킴 |
| 토큰을 암호화한다고 설명하지만 소스는 원문을 DB에 전달 | 앱 차원의 토큰 암호화 구현 또는 실제 인프라 보호 확인 후 정확한 표현 사용. 저장소/백업 암호화는 이번에 확인되지 않음 |
| 연동 해제·탈퇴 시 즉시 삭제한다고 설명하지만 해당 API/UI를 찾지 못함 | 권한 철회·토큰 삭제 및 계정 데이터 삭제 절차 구현. 로그아웃은 세션 삭제이며 토큰/일정 삭제가 아님 |
| Google 데이터의 제3자 공유를 전면 부인하지만 가져온 일정은 공유 캘린더 멤버가 열람 | 사용자가 선택한 캘린더의 멤버와 공유됨을 정책과 가져오기 직전 화면에 고지하고 동의받음 |
| 약관에 Google 일정을 서비스 외부로 전송하지 않는다고 설명 | 서버에서 가져오기·보관하며 지정한 캘린더 멤버에게 공개되는 실제 흐름을 명시 |
| 마이페이지는 Google 로그인 계정에도 이미 '연동됨'을 표시하여 추가 권한 요청 버튼이 없음 | Google 로그인과 캘린더 권한 연결 상태를 구분하고, Google 로그인 이용자도 캘린더 권한을 추가 승인할 수 있도록 수정 |
| hasGoogleCalendar는 access_token 존재만 검사 | 승인된 scope를 확인하여 openid 전용 토큰과 캘린더 토큰을 구분하고 권한 거절 시 기능을 비활성화 |

보유 기간, 운영자 접근, 백업 삭제, 외부 처리업체, 문의 메일 수신 가능 여부는 운영자가 확인할 항목입니다. 확인하지 않은 보호 조치나 삭제 기한을 심사 답변에 확정적으로 기재하면 안 됩니다.

## 4. 심사 입력용 영문 초안

다음 문구는 현재 기능에 맞춘 제출용 초안입니다. 콘솔에는 1,000자 제한에 맞춘 간결한 사유를 저장했습니다. 실제 계정 시연 영상은 별도로 준비해야 합니다.

### App description

Moa Calendar is a web-based shared calendar service. Users sign in, create calendars, invite members, and manage schedules together. An optional Google Calendar import feature lets users copy events from their primary Google calendar into a selected Moa calendar. Google Calendar data is accessed when the user requests an import. This feature does not create, modify, or delete events in Google Calendar.

### Scope justification: openid

Moa Calendar uses the openid scope to identify the user's Google account by its subject identifier and authenticate the user. Basic Google sign-in does not require access to Google Calendar. Calendar authorization is requested separately when the user enables the optional import feature.

### Scope justification: calendar.events.readonly

Moa Calendar uses https://www.googleapis.com/auth/calendar.events.readonly to retrieve event titles, start and end times, and descriptions from the user's primary Google calendar using the Calendar API events.list method. After the user selects a destination Moa calendar and a date range and requests an import, these fields are copied into that calendar so its authorized members can view the imported schedule. Read-only event access is needed because availability-only scopes do not provide the event titles and descriptions used by this feature. The app does not require permissions to modify Google events, manage Google calendars, or change Google Calendar sharing settings.

### Additional information

Production website: https://dwm.brightnetworks.kr/
Privacy policy: https://dwm.brightnetworks.kr/privacy
Terms of service: https://dwm.brightnetworks.kr/terms
Google Calendar import is optional and separate from basic sign-in. The app creates a new Moa calendar using the name entered by the user, then imports the selected date range into it. The user is not asked to connect Google data to an existing Moa calendar. The app does not provide two-way synchronization with Google Calendar.

데모 URL 항목에는 실제로 촬영하고 업로드한 영상 URL을 입력합니다. 임의의 URL이나 일반 서비스 소개 영상으로 대체하지 마세요.

## 5. 데모 영상 촬영 순서

Google 공식 지침에 따라 Google 로그인·동의 흐름은 영어로 촬영하고, 앱의 영어 UI도 사용하면 검토가 쉽습니다. 실제 개인 일정 대신 테스트 계정과 가상 일정(예: OAuth Demo Meeting)을 사용하세요.

1. `https://dwm.brightnetworks.kr/en/`에서 앱 이름·기능 소개·정책 링크를 보여줍니다.
2. Google 로그인 버튼부터 로그인 완료까지 보여줍니다. 기본 로그인과 캘린더 연결은 서로 다른 흐름임을 설명합니다.
3. 테스트용 모아 캘린더를 선택하고 Google Calendar 연결을 시작합니다. 추가 권한 연결 UI 수정 후 촬영하세요.
4. Google 동의 화면의 앱 이름과 요청하는 일정 읽기 권한을 보여줍니다. 주소창의 `client_id`가 위 OAuth 클라이언트와 일치하는지 보여줍니다. client secret, authorization code, access token, refresh token은 노출하지 마세요.
5. Google 캘린더에서 가상 일정의 제목·시간·설명을 보여줍니다.
6. Google 캘린더 가져오기 화면에서 새 Moa 캘린더 이름과 기간을 정하고, 안내를 확인한 다음 '새 캘린더 만들고 가져오기'를 실행합니다. 완료 후 새 캘린더가 열리는 것을 보여줍니다.
7. 가져온 일정의 제목·시간·설명이 모아에서 표시되는 것을 보여줍니다. Google 원본이 변경되지 않는다고 설명합니다.
8. 구현된 연결 해제/삭제 방법을 보여줍니다. 아직 없는 기능을 시연했다고 말하면 안 됩니다.
9. YouTube Studio에 업로드하고 공개 범위를 **일부 공개(Unlisted)**로 설정합니다. 로그인 없이 링크로 재생 가능한지 확인합니다.

영문 내레이션 예시:

> This is Moa Calendar, a shared scheduling app. Basic sign-in identifies the user without requesting Calendar access. The optional import feature asks for read-only access to Google Calendar events. The user names a new Moa calendar and chooses a date range before importing. Imported titles, times, and descriptions are stored in this separate calendar and can be viewed by members invited later. Moa does not modify or delete the original Google events.

## 6. 콘솔 제출 순서

1. 위 불일치를 해결하고 운영 배포 후 새 권한으로 실제 로그인·가져오기·철회/삭제를 검증합니다.
2. 프로젝트 Owner/Editor 계정으로 Search Console의 `brightnetworks.kr` 소유권을 확인합니다. DNS 변경이 필요하다면 해당 설정 권한과 값을 별도로 확인합니다.
3. API 및 서비스에서 Google Calendar API가 사용 설정되었는지 확인합니다.
4. Google 인증 플랫폼 → 데이터 액세스 → 범위 추가 또는 삭제에서 실제 최종 코드와 같은 `openid`, 일정 읽기 scope만 등록하고 저장합니다.
5. 인증 센터에서 데이터 액세스 검토를 진행하고 영문 권한 사유와 실제 데모 YouTube URL을 입력합니다. 현재 브랜딩은 이미 인증되어 있으므로 불필요하게 재검토를 시작하지 않습니다.
6. 데이터 사용·보유·공유·보안 관련 질문에는 검증된 실제 동작으로 답합니다. 약관 동의나 별도 승인 대상이 나타나면 최종 조작 전에 해당 내용을 검토합니다.
7. 제출 완료 상태를 확인하고 지원/개발자 이메일로 오는 Google 추가 요청에 회신합니다. 영상 업로드 및 심사 제출은 현재 미완료입니다.

프로덕션 게시와 데이터 권한 승인은 별도입니다. 게시 상태는 이미 프로덕션이므로 다시 게시할 필요가 없습니다. 현재 로그인만의 비민감 범위와 캘린더 민감 범위에 적용되는 제한을 혼동하지 마세요.

## 공식 근거

- [민감 권한 검토·최소 권한·공개 정책·영어 데모 요구](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Calendar API 범위 비교](https://developers.google.com/workspace/calendar/api/auth)
- [events.list 허용 권한과 primary 캘린더](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Google OAuth 앱 상태와 기본 로그인 범위 예외](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview)

## 작업 범위

앱 코드, 공개 정책, DB 마이그레이션과 암호화, 운영 배포, 콘솔의 범위 및 사용 사유 저장, Calendar API 활성화, 실제 Google 동의와 샘플 일정 가져오기 확인, 영문 자막 영상 편집을 완료했습니다. YouTube 일부 공개 업로드와 심사 제출은 남아 있습니다. Google 검토 승인 여부는 Google이 결정합니다.
