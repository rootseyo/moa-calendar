# 설정 UI 정리 — 2026-10-14

## 반영한 변경

- 설정 카드의 제목·설명·폼·버튼 여백과 44px 이상 버튼 높이를 통일했다.
- iCloud 계정 정보 / 계정 작업 / 마지막 동기화를 분리하고, 캘린더 이름 아래에 동기화 방향과 버튼을 같은 높이로 배치했다.
- 캘린더 이름을 체크박스의 label로 연결했다. 비활성 캘린더는 select와 동기화 버튼에 disabled를 적용하여 키보드 접근도 차단한다.
- 앱 암호 입력과 표시 버튼, 앱 암호 설명의 inline 강조, 도움말 줄간격을 정리했다.
- 프로필 계정 연동 행의 내부 여백, 목록 제목과 개수 표시, 가져오기 동의 체크박스 정렬을 수정했다.
- 모바일 목록을 grid로 배치하고 긴 이름 줄바꿈, 좁은 화면의 날짜 입력 세로 배치를 적용했다.

## 검증

- 운영 Chrome에서 캘린더 관리, iCloud, Google 가져오기, 캘린더 모으기, 계정, 언어/지역, 세션 7개 메뉴를 시각 점검했다.
- iCloud 연결 전 폼과 연결된 상태를 확인했다. 실제 계정 연결·해제·동기화는 실행하지 않았다.
- 관련 기존 테스트 14개 통과 및 한국어/영어 앱 JS 문법 검사 통과.
- 로컬 listen은 EPERM으로 제한된다. 브라우저 viewport override도 실제 innerWidth에 반영되지 않았다. 모바일 실화면과 영어 실화면 시각 검증은 미완료다.

## 운영 배포 범위

- public/style.css, public/index.html, public/locale.js 및 public/app.js의 renderICloudView 변경만 반영했다.
- 캐시 버전: 20261014-settings-layout-v2.
- 백업: pi-server:/home/sean/services/share-schedule-ui-backup-20261014-1650/.
- 로컬 app.js에 이전 작업의 동기화 응답 처리 변경이 남아 있어 운영 app.js와 동일하지 않다. 이번 UI 배포는 운영 app.js 원본에 renderICloudView와 캐시 버전만 교체한 파일(/tmp/moa-deploy-app.js)을 사용했다. 이전 작업의 서버·동기화 로직을 별도로 검증하지 않고 전체 deploy.sh로 배포하지 말 것.

## 후속 수정 — 17:03

- 사용자 요청으로 월간/주간/일간/선택 날짜 목록에서 캘린더 이름 prefix와 배지를 제거했다. 일정 자체 제목과 카테고리는 유지한다.
- 600px 이하에서 공휴일 이름을 날짜 숫자 아래로 배치하고 긴 이름의 줄바꿈을 허용했다. 운영 CSS에서 해당 미디어 규칙을 확인했다. 모바일 실화면 검증 제한은 그대로다.
- 운영 동기화 실패 원인은 events_color_check였다. iCloud hex 색상을 모아 색상으로 변환하는 caldav-sync.mjs 변경을 검증하여 배포했다.
- 이전 app.js의 동기화 응답 처리도 반영했다. 새 iCloud 캘린더는 표시 선택에 추가하며, 기존에 숨긴 캘린더 선택은 보존한다.
- 로컬 관련 테스트 25개 + 신규 표시 테스트 2개 통과. 로컬 listen 제한으로 실행되지 않은 CalDAV 통합 테스트 2개는 /tmp/moa-icloud-fix-validation의 격리된 모의 DB/CalDAV 서버에서 통과했다(실제 운영 DB를 테스트에 사용하지 않았다).
- 실제 iCloud 가져오기는 pullOnly로 실행해 원격 일정 쓰기 없이 39개를 모아에 저장했다. last_sync_at 갱신, 오류 없음, 화면에서 SK매직 저녁 모임 등 가져온 일정 표시를 확인했다.
- public/app.js는 이제 로컬 수정본 전체를 배포했다. 백업: /home/sean/services/share-schedule-backup-20261014-calendar-fixes/. 캐시 버전: 20261014-calendar-fixes-v1.
