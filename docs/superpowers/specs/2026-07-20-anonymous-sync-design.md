# 익명 키 동기화 설계

날짜: 2026-07-20 · 상태: 사용자 승인 완료 (경우 A: 본인 다기기 동기화, 계정 없음)

## 목적

폰의 localStorage 데이터를 맥에서도 쓸 수 있게 한다. 백업 JSON 파일을 손으로
옮기는 흐름을 없앤다. 로그인·계정 없이, 기기가 만든 랜덤 동기화 키가 곧 접근
권한이다.

## 서버 (Supabase 무료 티어, 사용자 본인 소유 프로젝트)

- 테이블 `sync_states(key text PK, data jsonb, updated_at timestamptz)`.
- RLS 활성 + 정책 없음 + anon 테이블 권한 회수 → 직접 접근 전부 차단.
- `security definer` RPC 두 개만 노출:
  - `sync_push(sync_key, payload)` — upsert. 키 20자 미만·payload 1MB 초과 거부.
  - `sync_pull(sync_key)` — payload 반환(없으면 null).
- 클라이언트 인증: 새 `sb_publishable_...` 키를 `apikey` 헤더로 전송
  (2025-11 이후 신규 프로젝트는 legacy anon JWT 미발급).
- SQL은 `supabase/schema.sql`로 저장, 사용자가 SQL Editor에 붙여넣는다.

## 클라이언트 (`sync.js` 신규 파일, app.js보다 먼저 로드)

- `SYNC_CONFIG = { url, apiKey }` — 사용자 프로젝트 값으로 채움. 비어 있으면
  동기화 UI는 "서버 설정 대기 중"으로 표시.
- 동기화 키: `crypto.randomUUID()` 2개 연결(하이픈 제거, 64자). localStorage
  별도 키 `one_hundred_million_sync_v1`에 `{ key, lastSyncedAt }` 저장.
- 업로드: `saveState()`마다 2초 디바운스 후 전체 상태 JSON을 push. 실패는
  조용히 무시(다음 저장·다음 앱 열기에 재시도).
- 다운로드: 앱 시작 시 pull → 방향 판정 → 서버가 새로우면 교체, 로컬이
  새로우면 push.
- 충돌 판정: 상태에 `updatedAt`(ISO, `saveState()`마다 갱신)을 넣고, 순수 함수
  `syncDirection(localUpdatedAt, serverUpdatedAt)` → `push|pull|none`.
  최신 쪽이 이긴다(LWW). 서버 교체 적용 시에는 `updatedAt`을 재기록하지 않아
  핑퐁을 막는다.

## UX

- 설정 탭 "동기화" 섹션:
  - 미설정: 안내 문구만.
  - 설정됨·꺼짐: [동기화 시작(새 키)] / [기존 키로 연결(키 입력→서버 데이터로
    교체, 로컬 데이터 있으면 confirm)]
  - 켜짐: 마지막 동기화 시각 · [지금 동기화] [키 보기·복사] [끄기(서버 데이터는
    유지, prompt/confirm 패턴)]
- 온보딩 위저드 첫 스텝에 "동기화 키로 가져오기" 보조 버튼(새 기기에서 결산
  온보딩을 거치지 않고 바로 연결하기 위함). 성공 시 서버 상태 적용 후 위저드 종료.
- 첫 화면(현실 탭)에는 아무것도 추가하지 않는다.

## 트레이드오프 (사용자 인지 완료)

- 동시 편집 시 나중 저장이 이김(단일 사용자라 실사용 충돌 희박).
- 키 소지 = 데이터 접근. publishable key는 공개 전제 설계라 저장소 공개 무방.

## 파일 변경

- `sync.js` 신규 · `logic.js` `syncDirection` + `tests.js` 테스트
- `app.js` saveState 훅·시작 시 pull·설정 섹션·온보딩 보조 버튼
- `index.html` 스크립트 태그 · `sw.js` ASSETS 추가 + CACHE eok-v9
- `supabase/schema.sql` 신규 · `CLAUDE.md` 기술 구조 갱신
