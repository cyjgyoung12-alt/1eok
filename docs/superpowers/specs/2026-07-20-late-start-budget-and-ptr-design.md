# 늦은 시작 예산 보정 + 당겨서 새로고침 설계

날짜: 2026-07-20 · 상태: 사용자 승인 완료

## 1. 늦은 시작 예산 보정 ("1일 시작 기준 빡세게")

문제: 월중(예: 20일)에 시작하면 한 달 변동예산 전체가 남은 일수에 분배되어
하루 예산이 뻥튀기된다(129만 ÷ 12일 = 10.7만). 늦게 합류했다고 보너스 예산이
생기면 안 된다.

- `dailyBudgets(monthBudget, spendByDay, daysTotal, startDay = 1)`로 확장.
- `startDay` 이전 날들은 하루 몫(`monthBudget ÷ daysTotal`)을 소진한 것으로
  처리한다. 그날 기록된 지출이 몫보다 크면 그 기록을 소진액으로 쓴다(max).
- 시작 전 날들은 `judged: false` — 스트릭·판정에 영향 없음.
- 시작일부터는 기존 재분배 로직 그대로(아끼면 오르고, 초과하면 내일이 준다).
- `startDay` 생략 시 기존 동작과 완전 동일(하위 호환).
- app.js `getMetrics`: `settings.startDate`가 이번 달이면 그 날짜, 아니면 1.

## 2. 당겨서 새로고침

- 화면 맨 위(scrollY 0)에서 아래로 당기면 상단 중앙에 민트 스피너가 따라
  내려오고, 임계값 이상에서 놓으면 실행: **① 서비스워커 업데이트 확인
  ② 수동 동기화**(pull → 방향 판정 → 적용/업로드). 완료 토스트.
- 동기화 미설정/꺼짐이면 안내 토스트만.
- 시트·온보딩 모달이 열려 있으면 제스처 무시. 스피너 DOM은 `#app` 밖
  고정 요소라 render()와 독립.
- "지금 동기화" 버튼과 로직 공유(`manualSync()`로 추출).
- 브라우저(비설치) 사파리의 네이티브 당김 새로고침과 겹치지 않게
  `overscroll-behavior-y: contain`.

## 파일 변경

`logic.js`·`tests.js`(startDay), `app.js`(getMetrics·manualSync·PTR 제스처),
`index.html`(스피너 요소), `styles.css`(스피너·당김), `sw.js` CACHE eok-v13.
