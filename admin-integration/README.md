# Share Schedule (모아 캘린더) — Admin 연동

본 디렉터리는 `../admin` (Bright Admin)과의 공유 캘린더 관리 연동 규격을 정리한 문서입니다.

## 1. 데이터베이스 연동 구조
- **DB 위치**: `pi-local-server` (192.168.219.109:5432)
- **DB 이름**: `share_schedule_db`
- **사용자**: `schedule_user`
- **어드민 환경변수**: `SCHEDULE_DATABASE_URL`

## 2. 관리 대상 상태 및 규칙

### 사용자 관리 (`users`)
- `status`: `'ACTIVE'` | `'SUSPENDED'`
- 정지(`SUSPENDED`) 처리 시:
  - `server.mjs`의 SSE 실시간 스트림 연결(`heartbeat` 주기 검증)에서 `access-revoked` 이벤트가 전송되며 연결이 즉시 강제 종료됩니다.
  - 정지된 사용자의 모든 신규 API 요청은 `403 이용이 정지된 계정입니다.`로 차단됩니다.
- 상태 변경 시 `admin_actions` 테이블에 조치 이력이 기록되며, `../admin` 감사 로그(`AuditLog`)에도 동시에 적재됩니다.

### 캘린더 관리 (`calendars`)
- `status`: `'ACTIVE'` | `'ARCHIVED'`
- 보관(`ARCHIVED`) 처리 시:
  - 캘린더 목록 및 일정 조회, 신규 일정 생성/수정, 초대 링크 참여가 차단됩니다.
- 상태 변경 시 `admin_actions` 테이블에 이력이 기록됩니다.

### 감사 로그 (`admin_actions`)
```sql
CREATE TABLE IF NOT EXISTS admin_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id text NOT NULL,
  action text NOT NULL,
  resource_id text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
```

## 3. 어드민 페이지 경로 (`../admin`)
- UI 경로: `/admin/schedule`
- API 경로:
  - `GET /api/admin/schedule/stats`: 요약 통계 및 최근 관리자 조치 내역
  - `GET /api/admin/schedule/users`: 사용자 목록 조회
  - `PATCH /api/admin/schedule/users`: 사용자 상태 변경 (`ACTIVE` / `SUSPENDED`)
  - `GET /api/admin/schedule/calendars`: 캘린더 목록 조회
  - `PATCH /api/admin/schedule/calendars`: 캘린더 상태 변경 (`ACTIVE` / `ARCHIVED`)
