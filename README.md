<p align="center">
  <img src="moa-calendar-promotional-banner-1024x500.png" alt="Moa Calendar Banner" width="100%" style="border-radius: 12px; max-width: 800px;" />
</p>

<h1 align="center">🗓️ 모아 (Moa Calendar)</h1>

<p align="center">
  <strong>"각자의 하루를, 우리의 시간으로"</strong><br>
  복잡한 가입이나 설치 없이 <strong>링크 하나로 즉시 함께 쓰는 초경량 실시간 공유 캘린더</strong>입니다.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D22.0.0-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Vanilla_JS-Zero_Bundler-F7DF1E?style=flat-square&logo=javascript&logoColor=black" alt="Vanilla JS" />
  <img src="https://img.shields.io/badge/PostgreSQL-336791?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Realtime-SSE-blue?style=flat-square" alt="Server-Sent Events" />
  <img src="https://img.shields.io/badge/Multiplatform-Web_%7C_Android_%7C_macOS-green?style=flat-square" alt="Multiplatform" />
  <img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License" />
</p>

---

## 🌟 왜 모아(Moa)인가요?

기존 대형 캘린더 서비스는 훌륭하지만, 연인, 가족, 소규모 스터디나 프로젝트 멤버들이 **"지금 당장 가볍게 일정을 공유"**하기에는 계정 초대, 권한 승인, 무거운 초기 로딩 등 진입 장벽이 높았습니다.

모아는 **무거운 프론트엔드 프레임워크(React, Next.js 등)와 번들러 없이**, 순수 최신 Vanilla JS와 단일 프로세스 Node.js로 설계되어 **0ms에 수렴하는 빠른 실행 속도와 즉각적인 반응성(Zero-latency UX)**을 제공합니다.

* 🔗 **링크 하나로 즉시 참여**: 복잡한 승인 과정 없이 초대 링크(편집 또는 읽기 전용)로 바로 캘린더에 합류
* ⚡ **체감 로딩 제로 (Zero-Latency)**: 번들 다운로드나 로딩 스피너 없이 열자마자 바로 뜨는 반응형 웹
* 🔄 **실시간 협업 (Presence & SSE)**: 같은 캘린더를 보고 있는 참여자의 실시간 접속 상태 표시와 변경 사항 지연 없는 즉각 동기화
* ☁️ **외부 캘린더 연동**: Google Calendar 및 Apple iCloud (CalDAV) 양방향 동기화 및 가져오기 지원
* 📱 **멀티 플랫폼 지원**: 모바일 웹/PWA, 안드로이드 전용 앱(홈 화면 위젯 포함), macOS 네이티브 데스크톱 앱 제공

---

## 📸 스크린샷

<div align="center">
  <table>
    <tr>
      <td align="center" width="25%">
        <img src="store_assets/phone_screenshots/01-shared-calendar.png" alt="실시간 공유 캘린더" width="100%" /><br>
        <b>실시간 공유 캘린더</b>
      </td>
      <td align="center" width="25%">
        <img src="store_assets/phone_screenshots/02-month-overview.png" alt="월간 뷰 & 날씨" width="100%" /><br>
        <b>월간 뷰 & 날씨 예보</b>
      </td>
      <td align="center" width="25%">
        <img src="store_assets/phone_screenshots/03-events-and-tasks.png" alt="일정 및 할 일 관리" width="100%" /><br>
        <b>일정 및 이달의 할 일</b>
      </td>
      <td align="center" width="25%">
        <img src="store_assets/phone_screenshots/04-holidays-and-lunar.png" alt="음력 및 공휴일" width="100%" /><br>
        <b>음력 / 공휴일 / D-Day</b>
      </td>
    </tr>
  </table>
</div>

---

## ✨ 핵심 기능

### 1. 실시간 공유 및 협업
- **소유자 초대 링크 발급**: 편집 가능 링크 / 읽기 전용 링크 분리 발급 및 7일 후 만료 처리
- **Server-Sent Events (SSE)**: 웹소켓 대비 방화벽 친화적인 SSE 기반 실시간 일정 동기화 및 재연결 보장
- **접속 세션 표시 (Presence)**: 현재 캘린더를 열고 있는 브라우저 탭 세션 실시간 표시
- **동시 수정 충돌 감지**: 일정 버전을 통한 덮어쓰기 방지 및 정밀한 잠금 처리

### 2. 스마트한 일정 및 할 일(To-Do) 관리
- **이달의 일정 & To-Do**: 특정 날짜 없이 해당 월 단위로 관리하는 To-Do 체크리스트
- **생활 밀착형 기능**:
  - ⛅ **날씨 예보 (Open-Meteo)**: 날짜별 실시간 날씨 이모지, 강수확률(%) 배지, 시간대별 상세 날씨 모달
  - 🚩 **D-Day 위젯**: 중요한 기념일/시험일 상단 위젯 및 자동 날짜 계산
  - 🌙 **한국 음력 / 윤달 지원**: 설날, 추석 등 주요 명절 및 매월 음력 표기
  - 🏖️ **글로벌 공휴일**: 한국, 미국, 일본, 영국 법정 공휴일 및 대체 공휴일 자동 렌더링
  - 🎨 **12가지 컬러 팔레트 & 취소선(완료) 표시**
  - 🔁 **매주 반복 일정 자동 생성 (최대 52주)**

### 3. 외부 캘린더 연동 및 마이그레이션
- **Google Calendar**: OAuth 2.0 PKCE 기반 안전한 토큰 암호화 보관, 구글 캘린더 일정 가져오기 및 복사
- **Apple iCloud (CalDAV)**: CalDAV 프로토콜을 통한 양방향 동기화, 일정 이동 및 충돌 시 큐 기반 자동 재시도
- **iCalendar (.ics) 표준 지원**: RFC 5545 호환 파서 및 내보내기

### 4. 보안 및 인증
- **다양한 로그인 방식**: 이메일/비밀번호(scrypt 암호화 해싱), Google 소셜 로그인, Kakao 소셜 로그인, 체험(Demo) 계정
- **안전한 보안 아키텍처**:
  - 토큰 필드 레벨 AES 암호화 (`OAUTH_TOKEN_ENCRYPTION_KEY`)
  - 엄격한 CSP (Content-Security-Policy), HttpOnly/SameSite 쿠키, Origin 검증
  - Web Push (VAPID) 알림 표준 준수

---

## 🛠️ 기술 스택

| 분류 | 기술 | 특징 |
| :--- | :--- | :--- |
| **Backend** | **Node.js (>=22)** | 대규모 프레임워크 없는 경량 단일 프로세스 아키텍처, Native Test Runner |
| **Frontend** | **Vanilla JS (ES Modules) + Modern CSS** | 무거운 번들러나 가상 DOM 없이 0ms에 가까운 빠른 렌더링 및 CSS 변수 기반 테마 |
| **Database** | **PostgreSQL** / **PGlite** (로컬 테스트) | 트랜잭션 보장, 관계형 권한 스키마, 마이그레이션 러너 |
| **Realtime** | **Server-Sent Events (SSE)** | 단방향 실시간 동기화, 방화벽 친화적 이벤트 스트림 |
| **Mobile** | **Android (Kotlin, Jetpack Compose)** | PWA/WebView 하이브리드 브릿지, 네이티브 앱 위젯 3종 (월간/주간/일간) |
| **Desktop** | **macOS (Swift, AppKit, WebKit)** | 오늘 날짜가 동적으로 그려지는 동적 AppIcon, 네이티브 윈도우 및 메뉴바 |

---

## 🚀 빠른 시작 (Getting Started)

### 사전 요구사항
* Node.js 22 이상
* PostgreSQL 14 이상

### 1. 저장소 클론 및 패키지 설치

```bash
git clone https://github.com/rootseyo/moa-calendar.git
cd moa-calendar
npm install
```

### 2. 환경 변수 설정

`.env.example`을 복사하여 `.env` 파일을 생성합니다.

```bash
cp .env.example .env
```

`.env` 파일의 주요 항목:
```env
PORT=3000
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://user:password@localhost:5432/moa_calendar_db
DEMO_MODE=false
```

* **VAPID 웹 푸시 키 생성**:
  ```bash
  node scripts/ensure-vapid-keys.mjs
  ```
* **OAuth 토큰 암호화 키 생성**:
  ```bash
  node scripts/ensure-token-key.mjs
  ```

### 3. 데이터베이스 마이그레이션

```bash
npm run db:migrate
```

### 4. 로컬 서버 실행

```bash
# 개발 모드 실행 (체험 로그인 활성화)
npm run dev

# 또는 운영 모드 실행
npm start
```

브라우저에서 `http://localhost:3000`으로 접속하여 즉시 사용할 수 있습니다.

---

## ⚙️ 상세 환경 변수 가이드

| 환경변수 | 필수 | 기본값 | 설명 |
| :--- | :---: | :--- | :--- |
| `PORT` | 선택 | `3000` | 서버 수신 포트 |
| `APP_URL` | **필수** | `http://localhost:3000` | 외부 접속 기본 URL (끝에 `/` 제외) |
| `DATABASE_URL` | **필수** | - | PostgreSQL 연결 문자열 (`postgresql://...`) |
| `DEMO_MODE` | 선택 | `false` | `true` 설정 시 원클릭 체험 로그인 버튼 노출 |
| `GOOGLE_CLIENT_ID` | 선택 | - | Google OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | 선택 | - | Google OAuth 2.0 Client Secret |
| `KAKAO_CLIENT_ID` | 선택 | - | Kakao Developers REST API 키 |
| `KAKAO_CLIENT_SECRET` | 선택 | - | Kakao 로그인 활성화 Client Secret |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | 선택 | - | Google/iCloud 인증 토큰 암호화용 64자리 16진수 키 |
| `VAPID_PUBLIC_KEY` | 선택 | - | Web Push 알림 공개 키 |
| `VAPID_PRIVATE_KEY` | 선택 | - | Web Push 알림 비공개 키 |
| `VAPID_SUBJECT` | 선택 | `mailto:admin@example.com` | Web Push 규격 식별자 (이메일 또는 URL) |
| `ANALYTICS_ENDPOINT` | 선택 | - | 자체 분석/통계 수집 서버 API 엔드포인트 |

---

## 🖥️ 플랫폼별 클라이언트

### 🍏 macOS 네이티브 앱
Swift와 AppKit 기반으로 빌드되는 초경량 데스크톱 앱입니다.
```bash
npm run build:macos
```
빌드 완료 시 `macos/build/MoaCalendar.app`이 생성되며, 캘린더 아이콘에 오늘의 날짜가 실시간으로 렌더링됩니다.

### 🤖 Android 앱 (Kotlin + Compose)
`android/` 디렉터리에 위치하며 Android Studio에서 바로 열 수 있습니다.
* **홈 화면 위젯 3종 지원**: 월간 달력 위젯, 주간 일정 위젯, 오늘 일정 위젯
* **빌드**:
  ```bash
  cd android
  ./gradlew assembleRelease
  ```

---

## 🧪 테스트 실행

내장된 Node.js Test Runner를 사용하여 인프로세스 및 단위 테스트를 수행합니다.

```bash
npm test
```

구문 및 문법 검사:
```bash
node --check server.mjs
node --check public/app.js
```

---

## 📄 라이선스 (License)

이 프로젝트는 [MIT 라이선스](LICENSE)에 따라 자유롭게 사용, 수정, 배포할 수 있습니다.
