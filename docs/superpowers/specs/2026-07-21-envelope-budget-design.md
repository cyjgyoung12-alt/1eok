# 월급날 봉투 예산 설계

날짜: 2026-07-21 · 상태: 사용자 승인 완료 (진짜 연동 + 소프트 경고)

## 리서치 근거 (토스·위플·YNAB 3방향 조사)

- 월급일(25일)과 달력 월 불일치는 "월급으로 **다음 달** 예산을 짠다"(YNAB Age
  Your Money)로 해소 — 미션·결산의 달력 월 기준과 정합.
- 예산 이탈 1위 원인은 복잡함(37%). 봉투는 적게, 빈 칸은 봉투 없음으로 취급.
- 초과는 실패가 아니라 정보(소프트 피드백) — 앱의 "초과해도 실패 없음"과 일치.
- 한 달 건너뛰면 그 달은 봉투 없이 기존 동작 — "빼먹어도 안 망가짐" 유지.

## 데이터

- `state.budgets = { "2026-08": { saving, envelopes: [{category, amount}] } }`
  월 키당 1건(재작성은 교체). localStorage·백업·동기화에 자동 포함.
- `state.budgetPromptDismissed = "2026-08"` — 월급날 자동 시트를 그 달에 한 번만.

## 순수 로직 (logic.js + tests.js)

- `effectiveMonthlySaving(requiredSaving, budgetSaving)` — 예산 저축이 필요
  월저축보다 크면 그것을 사용(내려가진 않음, 목표 보호).
- `envelopeStatus(envelopes, spentByCategory)` — 봉투별 spent/remaining/over.
- `shouldPromptBudget(today, paydayDay, budgets, dismissedMonth)` — 월급일 이후
  & 다음 달 예산 없음 & 미해제 → 다음 달 키 반환, 아니면 false.
- `renameCategoryInBudgets(budgets, from, to)` — 카테고리 이름 변경 시 봉투 이관.

## 미션 연동

`getMetrics`: `monthBudget = 수입 − 고정비 − effectiveMonthlySaving(필요저축,
이번 달 예산의 saving)`. 8월 예산은 8월 미션에만 반영.

## UI

- **예산 시트** `openBudgetSheet(targetMonth)`: 월 수입·고정비(자동 표시) →
  저축액 입력(필요 월저축 프리필, 저장 시 필요 월저축 미만이면 올려 저장) →
  변동 카테고리(고정비 제외, 기본+커스텀)별 금액 입력(빈 칸 = 봉투 없음) →
  하단 "미배분 N원" 실시간(음수면 경고 문구, 저장은 허용).
- **월급날 자동 노출**: 부팅 시 월급일(활성 수입 고정 항목의 day) 이후 & 다음 달
  예산 없음 & 온보딩 완료 & 다른 모달 없음 → 다음 달 예산 시트 자동 1회.
  자동 노출 즉시 dismissed 기록. 수입 고정 항목이 없으면 자동 노출 없음.
- **흐름 탭 "이번 달 예산" 카드**(자산 구성 아래): 봉투별 진행바(초과는 부호·
  문구로 표시, 색 차단 없음) + 저축 행 + 예산 편집 버튼. 예산 없으면 "예산
  정하기" 버튼만. 첫 화면(현실 탭)은 변경 없음.
- iOS PWA 제약상 진짜 푸시 알람은 1단계 제외(서버 필요). 시트 자동 노출로 대체.

## 파일 변경

`logic.js`·`tests.js`, `app.js`(getMetrics·시트·흐름 카드·부팅 프롬프트·카테고리
이름변경 이관), `styles.css`, `sw.js` CACHE eok-v16.
