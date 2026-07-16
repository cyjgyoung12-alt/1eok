# "1억 모으기" 개편 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 미션(매일)·기록(수시)·결산(월 1회) 3레이어 구조 + Void 다크 테마 + PWA로 앱을 개편하고 GitHub Pages에 배포한다.

**Architecture:** 의존성 없는 정적 웹앱 유지. 순수 계산 로직을 `logic.js`(브라우저 전역 + node module.exports 겸용)로 분리해 node로 테스트하고, `app.js`는 상태·렌더링만 담당. localStorage 키를 v2로 교체(마이그레이션 없음), 서비스워커로 PWA 완성.

**Tech Stack:** Vanilla JS / CSS, localStorage, Service Worker, GitHub Pages. 테스트는 `node tests.js` (의존성 0).

**스펙:** `docs/superpowers/specs/2026-07-13-1eok-redesign-design.md` — 모든 수치·규칙의 원천. 충돌 시 스펙이 이긴다.

---

## 파일 구조

| 파일 | 책임 | 상태 |
|---|---|---|
| `logic.js` | 순수 계산: 날짜 유틸, 필요저축, 재분배 예산, 미션 판정/스트릭, 결산 델타, 속도, 도착일 | 신규 |
| `tests.js` | `node tests.js`로 logic.js 검증 (assert, 의존성 0) | 신규 |
| `app.js` | 상태(v2)·렌더·시트·이벤트. 기존 파일 전면 재작성 | 재작성 |
| `styles.css` | Void 테마 전면 교체 | 재작성 |
| `index.html` | logic.js 로드 추가, iOS PWA 메타태그 | 수정 |
| `manifest.json` | 다크 테마·아이콘 | 수정 |
| `sw.js` | 캐시-우선 서비스워커 | 신규 |
| `icons/icon.svg` + PNG(180/192/512) | "1억" 그라데이션 아이콘 | 신규 |
| `CLAUDE.md`, `README.md` | 새 원칙 반영 | 수정 |

용어(스펙과 동일): **변동지출** = `type==="expense" && source!=="fixed"` 거래.

---

### Task 1: logic.js — 순수 계산 코어 (TDD)

**Files:**
- Create: `logic.js`
- Create: `tests.js`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests.js` 전체:

```js
const L = require("./logic.js");
let failed = 0;
function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failed++; console.error(`FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
  else console.log(`ok ${name}`);
}
function approx(name, actual, expected, tol = 0.01) {
  if (Math.abs(actual - expected) > tol) { failed++; console.error(`FAIL ${name}: got ${actual}, want ~${expected}`); }
  else console.log(`ok ${name}`);
}

// 날짜 유틸
eq("monthDiff same", L.monthDiff("2026-07", "2026-07"), 0);
eq("monthDiff cross-year", L.monthDiff("2025-11", "2026-02"), 3);
eq("daysInMonth Feb 2026", L.daysInMonth(2026, 2), 28);

// 필요 월저축 = 남은 금액 / max(1, 남은 개월)
const today = new Date(2026, 6, 13); // 2026-07-13
approx("requiredSaving", L.requiredMonthlySaving(100000000, 26580000, "2030-12-31", today), 73420000 / 53);
approx("requiredSaving floor 1mo", L.requiredMonthlySaving(100000000, 99000000, "2026-07-20", today), 1000000);
eq("requiredSaving done", L.requiredMonthlySaving(100000000, 100000000, "2030-12-31", today), 0);

// 월 변동예산
eq("monthBudget", L.monthlyVariableBudget(3200000, 600000, 1360000), 1240000);

// 재분배형 일일 예산: 월예산 310,000 / 31일 → 1일 10,000
// 1일에 15,000 썼으면(초과) 2일 예산 = (310000-15000)/30 = 9,833.33
const days = L.dailyBudgets(310000, { 1: 15000, 3: 5000 }, 31);
approx("day1 budget", days[0].budget, 10000);
eq("day1 judged+fail", [days[0].judged, days[0].clear], [true, false]);
approx("day2 budget redistributed", days[1].budget, (310000 - 15000) / 30);
eq("day2 unjudged", [days[1].judged, days[1].clear], [false, false]);
eq("day3 clear", [days[2].judged, days[2].clear], [true, true]);
eq("dailyBudgets length", days.length, 31);
// 예산 소진 후에도 음수 예산은 없다
const drained = L.dailyBudgets(10000, { 1: 50000 }, 31);
eq("budget floor 0", drained[1].budget, 0);

// 스트릭: 미판정일은 건너뛰고, 실패에서 끊긴다 (오늘=7일)
// day7 clear, day6 unjudged, day5 clear, day4 fail → streak 2
const streakDays = L.dailyBudgets(310000, { 4: 999999, 5: 3000, 7: 3000 }, 31);
eq("streak skips unjudged, stops at fail", L.missionStreak(streakDays, 7), 2);
eq("streak today over = 0", L.missionStreak(L.dailyBudgets(310000, { 7: 999999 }, 31), 7), 0);

// 결산 델타: 갭 월은 개월 수로 정규화
const settlements = [
  { month: "2026-03", total: 20000000 },
  { month: "2026-04", total: 21000000 },
  { month: "2026-06", total: 25000000 }, // 5월 결산 없음 → (25M-21M)/2 = 2M/월
];
eq("deltas normalized", L.settlementDeltas(settlements), [1000000, 2000000]);

// 속도: 델타 있으면 최근 3개 평균, 없으면 필요저축 가정
eq("speed actual", L.savingSpeed(settlements, 1360000),
  { monthlySaving: 1500000, basis: "actual", deltaCount: 2 });
eq("speed assumed", L.savingSpeed([{ month: "2026-07", total: 26580000 }], 1360000),
  { monthlySaving: 1360000, basis: "assumed", deltaCount: 0 });
eq("speed none", L.savingSpeed([{ month: "2026-07", total: 26580000 }], 0),
  { monthlySaving: 0, basis: "none", deltaCount: 0 });

// 현재 자산 = 최신 결산 총액 + 결산일 이후 거래 순액 (결산 당일 거래는 제외)
const txs = [
  { type: "income", amount: 3200000, date: "2026-07-25", source: "fixed" },
  { type: "expense", amount: 12000, date: "2026-07-13", source: "manual" },
  { type: "expense", amount: 99999, date: "2026-06-30", source: "manual" }, // 결산 당일 → 제외
];
eq("netWorth", L.currentNetWorth({ date: "2026-06-30", total: 25000000 }, txs), 25000000 + 3200000 - 12000);

// 도착 예상일
eq("arrival", L.localDateString(L.arrivalDate(7342000, 1500000, today)).slice(0, 7), "2026-12"); // ceil(4.89)=5개월
eq("arrival none", L.arrivalDate(7342000, 0, today), null);

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log("\nall tests passed");
```

- [ ] **Step 2: 실패 확인**

Run: `node tests.js`
Expected: `Error: Cannot find module './logic.js'`

- [ ] **Step 3: logic.js 구현** — 전체:

```js
function pad(value) {
  return String(value).padStart(2, "0");
}

function localDateString(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(value) {
  if (value instanceof Date) return value;
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day || 1);
}

function monthKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function monthDiff(fromMonth, toMonth) {
  const [ay, am] = fromMonth.split("-").map(Number);
  const [by, bm] = toMonth.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function monthsBetween(fromDate, toDate) {
  const from = parseDate(localDateString(fromDate));
  const to = parseDate(localDateString(toDate));
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, months + (to.getDate() >= from.getDate() ? 0 : -1));
}

function addMonths(date, count) {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + count);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(fromDate, toDate) {
  return Math.max(0, Math.floor((startOfDay(toDate) - startOfDay(fromDate)) / 86400000));
}

function requiredMonthlySaving(targetAmount, currentNetWorth, targetDate, today) {
  const remaining = Math.max(0, targetAmount - currentNetWorth);
  if (remaining === 0) return 0;
  const months = Math.max(1, monthsBetween(today, parseDate(targetDate)));
  return remaining / months;
}

function monthlyVariableBudget(monthlyIncome, fixedExpenseSum, requiredSaving) {
  return monthlyIncome - fixedExpenseSum - requiredSaving;
}

// spendByDay: { [일(1-based)]: 그날 변동지출 합 }. 키 존재 = 그날 기록 있음(판정 대상).
function dailyBudgets(monthBudget, spendByDay, daysTotal) {
  const results = [];
  let spentBefore = 0;
  for (let day = 1; day <= daysTotal; day += 1) {
    const daysLeft = daysTotal - day + 1;
    const budget = Math.max(0, (monthBudget - spentBefore) / daysLeft);
    const judged = Object.prototype.hasOwnProperty.call(spendByDay, day);
    const spent = judged ? Number(spendByDay[day]) : 0;
    results.push({ day, budget, spent, judged, clear: judged && spent <= budget });
    spentBefore += spent;
  }
  return results;
}

// 오늘부터 거꾸로: 미판정일은 건너뛰고, 실패를 만나면 끊는다.
function missionStreak(dayResults, todayDay) {
  let streak = 0;
  for (let day = todayDay; day >= 1; day -= 1) {
    const result = dayResults[day - 1];
    if (!result || !result.judged) continue;
    if (!result.clear) break;
    streak += 1;
  }
  return streak;
}

// 월 오름차순 정렬 후 인접 쌍의 (총액차 ÷ 개월차) — 갭 월은 월평균으로 정규화
function settlementDeltas(settlements) {
  const sorted = settlements.slice().sort((a, b) => (a.month < b.month ? -1 : 1));
  const deltas = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = Math.max(1, monthDiff(sorted[i - 1].month, sorted[i].month));
    deltas.push((sorted[i].total - sorted[i - 1].total) / gap);
  }
  return deltas;
}

function savingSpeed(settlements, requiredSaving) {
  const deltas = settlementDeltas(settlements).slice(-3);
  if (deltas.length > 0) {
    const average = deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
    return { monthlySaving: average, basis: "actual", deltaCount: deltas.length };
  }
  if (requiredSaving > 0) {
    return { monthlySaving: requiredSaving, basis: "assumed", deltaCount: 0 };
  }
  return { monthlySaving: 0, basis: "none", deltaCount: 0 };
}

// 결산 당일 거래는 잔고에 반영된 것으로 보고 제외(date > settlement.date만 합산)
function currentNetWorth(latestSettlement, transactions) {
  const net = transactions
    .filter((tx) => tx.date > latestSettlement.date)
    .reduce((sum, tx) => sum + (tx.type === "income" ? 1 : -1) * Number(tx.amount || 0), 0);
  return Number(latestSettlement.total) + net;
}

function arrivalDate(remaining, monthlySaving, today) {
  if (!(monthlySaving > 0)) return null;
  return addMonths(today, Math.ceil(remaining / monthlySaving));
}

const api = {
  pad, localDateString, parseDate, monthKey, monthDiff, daysInMonth,
  monthsBetween, addMonths, startOfDay, daysBetween,
  requiredMonthlySaving, monthlyVariableBudget, dailyBudgets, missionStreak,
  settlementDeltas, savingSpeed, currentNetWorth, arrivalDate,
};
if (typeof module !== "undefined") module.exports = api;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node tests.js`
Expected: 모든 줄 `ok ...` + `all tests passed`, exit 0

- [ ] **Step 5: 커밋**

```bash
git add logic.js tests.js
git commit -m "feat: 순수 계산 코어(logic.js) + node 테스트"
```

---

### Task 2: Void 테마 styles.css 전면 교체

**Files:**
- Rewrite: `styles.css`

- [ ] **Step 1: styles.css 전체를 아래로 교체** (토큰은 스펙 §비주얼 디자인 값 그대로):

```css
:root {
  --bg: #0b0d10;
  --card: #12151a;
  --card-strong: #171b21;
  --line: #22262e;
  --line-strong: #2e333c;
  --text: #f2f4f7;
  --muted: #8b93a1;
  --faint: #5c6470;
  --mint: #3ce8a4;
  --mint-dim: rgba(60, 232, 164, 0.4);
  --danger: #f2f4f7; /* 지출은 색이 아니라 부호·보더로 구분 */
  color-scheme: dark;
  font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
}
* { box-sizing: border-box; }
html, body { min-height: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); }
button, input, select { font: inherit; color: inherit; }
button { border: 0; cursor: pointer; background: none; padding: 0; }
input, select {
  width: 100%; padding: 11px 12px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--card-strong); color: var(--text);
}
input:focus, select:focus { outline: 1px solid var(--mint); border-color: var(--mint); }

.app-shell { width: min(100%, 430px); min-height: 100dvh; margin: 0 auto; position: relative; }
.screen { min-height: 100dvh; padding: 18px 16px calc(84px + env(safe-area-inset-bottom)); }
.screen-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.title { margin: 0; font-size: 22px; font-weight: 900; letter-spacing: -0.5px; }
.date-pill { font-size: 12px; color: var(--muted); border: 1px solid var(--line); background: var(--card); padding: 6px 9px; border-radius: 8px; }

.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 14px; }
.section { margin-top: 10px; }
.num { font-variant-numeric: tabular-nums; letter-spacing: -0.5px; }

/* 미션 카드 */
.mission-card { border-color: var(--line-strong); }
.mission-head { display: flex; justify-content: space-between; align-items: baseline; }
.mission-label { margin: 0; font-size: 12px; color: var(--muted); letter-spacing: 0.3px; }
.mission-streak { font-size: 12px; font-weight: 700; color: var(--mint); }
.mission-remaining { margin: 4px 0 0; font-size: 34px; font-weight: 700; }
.mission-remaining .unit { font-size: 15px; font-weight: 500; color: var(--muted); }
.mission-remaining.over { color: var(--muted); }
.mission-sub { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
.mission-warn { margin: 6px 0 0; font-size: 12px; color: var(--mint); }

.progress-track { height: 4px; border-radius: 2px; background: var(--line); margin-top: 10px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 2px; background: var(--mint); }
.progress-fill.plain { background: var(--text); }

/* 빠른 입력 버튼 */
.quick-actions { display: flex; gap: 8px; }
.action-button { flex: 1; padding: 13px 0; border-radius: 8px; font-size: 15px; font-weight: 700; text-align: center; border: 1px solid var(--line-strong); }
.action-button.expense { color: var(--text); }
.action-button.income { color: var(--mint); }
.action-button:active { background: var(--card-strong); }

/* 1억 카드 */
.hero-label { margin: 0; font-size: 12px; color: var(--muted); }
.hero-money { margin: 4px 0 0; font-size: 26px; font-weight: 800; }
.hero-sub { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
.basis-button { margin-top: 8px; font-size: 11px; color: var(--faint); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }

/* 결산 카드 + 롤링 12개월 그리드 */
.settle-head { display: flex; justify-content: space-between; align-items: baseline; }
.settle-grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; margin-top: 10px; }
.settle-cell { aspect-ratio: 1; border-radius: 2px; background: var(--line); }
.settle-cell.done { background: var(--mint); }
.settle-cell.low { background: var(--mint-dim); }
.settle-cell.current { background: transparent; border: 1.5px dashed var(--mint); }
.settle-sub { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
.settle-cta { display: block; width: 100%; margin-top: 10px; padding: 11px 0; border-radius: 8px; background: var(--mint); color: #06281b; font-weight: 800; font-size: 14px; text-align: center; }

/* 리스트 공통 */
.section-title-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
.section-title { margin: 0; font-size: 14px; font-weight: 800; }
.section-note { font-size: 11px; color: var(--faint); }
.money-row { display: flex; justify-content: space-between; padding: 7px 0; font-size: 13px; }
.money-row span { color: var(--muted); }
.empty-state { padding: 18px 0; text-align: center; color: var(--faint); font-size: 12px; }

.transaction-list { display: flex; flex-direction: column; gap: 8px; }
.transaction-item { display: flex; justify-content: space-between; align-items: center; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 11px 12px; }
.item-title { margin: 0; font-size: 13px; font-weight: 600; }
.item-sub { margin: 3px 0 0; font-size: 11px; color: var(--faint); }
.item-amount { font-size: 13px; font-weight: 700; text-align: right; }
.item-amount.income { color: var(--mint); }
.ghost-button { font-size: 11px; color: var(--faint); padding: 4px 6px; }
.danger-button, .secondary-button { width: 100%; padding: 11px 0; border-radius: 8px; border: 1px solid var(--line-strong); font-size: 13px; font-weight: 700; text-align: center; }
.danger-button { color: #ff8f85; border-color: #4a2622; }
.primary-button { width: 100%; padding: 13px 0; border-radius: 8px; background: var(--text); color: var(--bg); font-size: 15px; font-weight: 800; }
.button-row { display: flex; gap: 8px; }
.button-row > * { flex: 1; }

/* 바 차트(흐름 탭 추세) */
.bar-row { display: grid; grid-template-columns: 44px 1fr 84px; gap: 8px; align-items: center; padding: 5px 0; font-size: 12px; }
.bar-label { color: var(--muted); }
.bar-track { height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.bar-fill { height: 100%; border-radius: 3px; background: var(--mint); }
.bar-fill.negative { background: var(--faint); }
.bar-value { text-align: right; color: var(--text); }

.category-list { display: flex; flex-direction: column; gap: 8px; }
.category-card { padding: 11px 12px; }
.category-top { display: flex; justify-content: space-between; font-size: 13px; }
.mini-track { height: 4px; border-radius: 2px; background: var(--line); margin-top: 8px; overflow: hidden; }
.mini-fill { height: 100%; background: var(--faint); border-radius: 2px; }

/* 시트(모달) */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: flex; align-items: flex-end; justify-content: center; z-index: 30; }
.sheet { width: min(100%, 430px); max-height: 88dvh; overflow-y: auto; background: var(--card); border: 1px solid var(--line-strong); border-bottom: 0; border-radius: 8px 8px 0 0; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); }
.sheet-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.sheet-title { margin: 0; font-size: 16px; font-weight: 800; }
.form-grid { display: flex; flex-direction: column; gap: 12px; }
.field label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 6px; }
.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { padding: 8px 12px; border-radius: 8px; border: 1px solid var(--line); font-size: 12px; color: var(--muted); }
.chip.active { border-color: var(--mint); color: var(--mint); }
.advanced-fields summary { font-size: 12px; color: var(--faint); cursor: pointer; margin: 2px 0 8px; }

/* 결산 시트 계좌 행 */
.account-row { display: grid; grid-template-columns: 1fr 140px; gap: 8px; align-items: center; }
.account-row .name { font-size: 13px; }
.account-row .prev { font-size: 10px; color: var(--faint); }
.settle-total { display: flex; justify-content: space-between; font-size: 14px; font-weight: 800; padding: 10px 0; border-top: 1px solid var(--line); margin-top: 4px; }

/* 보고서 */
.report-headline { margin: 0; font-size: 24px; font-weight: 800; }
.report-line { display: flex; justify-content: space-between; font-size: 13px; padding: 7px 0; }
.report-line span { color: var(--muted); }
.report-verdict { margin: 10px 0 0; font-size: 13px; color: var(--mint); }
.report-verdict.miss { color: var(--muted); }

/* 온보딩 */
.onboarding-backdrop { align-items: center; }
.onboarding-sheet { border-radius: 8px; border-bottom: 1px solid var(--line-strong); max-height: 92dvh; }
.onboarding-copy { margin: 0 0 4px; font-size: 13px; color: var(--muted); }

/* 하단 탭 */
.bottom-nav { position: fixed; bottom: 0; left: 50%; transform: translateX(-50%); width: min(100%, 430px); display: flex; background: rgba(11, 13, 16, 0.92); backdrop-filter: blur(12px); border-top: 1px solid var(--line); padding: 8px 0 calc(8px + env(safe-area-inset-bottom)); z-index: 20; }
.nav-button { flex: 1; padding: 8px 0; font-size: 12px; color: var(--faint); text-align: center; }
.nav-button.active { color: var(--text); font-weight: 800; }

.toast { position: fixed; bottom: calc(92px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%); max-width: min(92%, 400px); background: var(--card-strong); border: 1px solid var(--line-strong); color: var(--text); font-size: 13px; padding: 11px 14px; border-radius: 8px; z-index: 40; }
.hidden-file { display: none; }
```

- [ ] **Step 2: 문법 확인 겸 서버 기동**

Run: `node --check app.js && python3 -m http.server 4173 &` 후 `curl -s localhost:4173/styles.css | head -3`
Expected: `:root {` 출력 (아직 app.js는 구버전이라 화면은 깨져 보여도 됨 — Task 3에서 재작성)

- [ ] **Step 3: 커밋**

```bash
git add styles.css
git commit -m "feat: Void 다크 테마 CSS 전면 교체"
```

---

### Task 3: app.js 재작성 1/3 — 상태 v2 + 메트릭 + 현실 탭

app.js를 **아래 내용으로 전면 교체**한다(기존 내용 전부 삭제). 이 태스크가 끝나면 현실 탭과 지출/수입 입력이 동작한다(결산·설정 등은 Task 4-5에서 추가).

**Files:**
- Rewrite: `app.js`
- Modify: `index.html` (logic.js 로드)

- [ ] **Step 1: index.html의 `<script src="./app.js"></script>` 앞에 추가**

```html
<script src="./logic.js"></script>
```

- [ ] **Step 2: app.js 전체 교체** — 다음 코드로:

```js
const STORE_KEY = "one_hundred_million_mobile_v2";

const tabs = [
  { id: "reality", label: "현실" },
  { id: "record", label: "기록" },
  { id: "flow", label: "흐름" },
  { id: "settings", label: "설정" },
];

const expenseCategories = ["식비", "카페", "교통", "생활", "구독", "고정비", "기타"];
const incomeCategories = ["급여", "부수입", "이자", "환급", "기타"];

function defaultState() {
  return {
    activeTab: "reality",
    hasOnboarded: false,
    toast: "",
    settings: {
      targetAmount: 100000000,
      targetDate: "2030-12-31",
      monthlyIncome: 0,
      startDate: localDateString(new Date()),
    },
    accounts: [],
    settlements: [],
    transactions: [],
    fixedItems: [],
  };
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (!saved) return defaultState();
    const parsed = JSON.parse(saved);
    return {
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...parsed.settings },
      accounts: parsed.accounts || [],
      settlements: parsed.settlements || [],
      transactions: parsed.transactions || [],
      fixedItems: parsed.fixedItems || [],
      toast: "",
    };
  } catch {
    return defaultState();
  }
}

function saveState() {
  const { toast, ...persisted } = state;
  localStorage.setItem(STORE_KEY, JSON.stringify(persisted));
}

function setState(next) {
  state = typeof next === "function" ? next(state) : next;
  saveState();
  render();
}

/* ---------- 파생 지표 (모든 계산은 logic.js 순수 함수 사용) ---------- */

function latestSettlement(settlements) {
  return settlements.slice().sort((a, b) => (a.month < b.month ? -1 : 1)).at(-1) || null;
}

function getMetrics(currentState) {
  const today = new Date();
  const currentMonth = monthKey(today);
  const s = currentState.settings;
  const latest = latestSettlement(currentState.settlements);

  const netWorth = latest ? currentNetWorth(latest, currentState.transactions) : 0;
  const remaining = Math.max(0, Number(s.targetAmount || 0) - netWorth);
  const progress = Math.max(0, Math.min(100, (netWorth / Number(s.targetAmount || 1)) * 100));
  const requiredSaving = requiredMonthlySaving(Number(s.targetAmount || 0), netWorth, s.targetDate, today);

  const fixedExpenseSum = currentState.fixedItems
    .filter((item) => item.active && item.type === "expense")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const monthBudget = monthlyVariableBudget(Number(s.monthlyIncome || 0), fixedExpenseSum, requiredSaving);

  // 이번 달 변동지출을 일별로 집계 (키 존재 = 그날 기록 있음)
  const spendByDay = {};
  const monthTx = currentState.transactions.filter((tx) => monthKey(parseDate(tx.date)) === currentMonth);
  monthTx
    .filter((tx) => tx.type === "expense" && tx.source !== "fixed")
    .forEach((tx) => {
      const day = parseDate(tx.date).getDate();
      spendByDay[day] = (spendByDay[day] || 0) + Number(tx.amount || 0);
    });

  const daysTotal = daysInMonth(today.getFullYear(), today.getMonth() + 1);
  const todayDay = today.getDate();
  const dayResults = dailyBudgets(Math.max(0, monthBudget), spendByDay, daysTotal);
  const todayResult = dayResults[todayDay - 1];
  const streak = missionStreak(dayResults, todayDay);

  const speed = savingSpeed(currentState.settlements, requiredSaving);
  const arrival = arrivalDate(remaining, speed.monthlySaving, today);
  const basisLabel =
    speed.basis === "actual"
      ? `최근 결산 ${speed.deltaCount}개월 기준`
      : speed.basis === "assumed"
        ? "목표 페이스 가정 · 첫 결산 후 실제 기준 전환"
        : "데이터 부족 · 결산을 시작하세요";

  const settledThisMonth = currentState.settlements.some((st) => st.month === currentMonth);
  const settleDday = daysTotal - todayDay;
  const settleStreak = countSettleStreak(currentState.settlements, currentMonth);
  const grid = buildGrid(currentState.settlements, currentMonth);

  const monthIncome = monthTx.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount), 0);
  const monthExpense = monthTx.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount), 0);
  const categoryExpenses = monthTx
    .filter((tx) => tx.type === "expense")
    .reduce((acc, tx) => {
      acc[tx.category] = (acc[tx.category] || 0) + Number(tx.amount || 0);
      return acc;
    }, {});

  return {
    today, currentMonth, netWorth, remaining, progress, requiredSaving,
    fixedExpenseSum, monthBudget, dayResults, todayResult, todayDay, streak,
    speed, arrival, basisLabel, settledThisMonth, settleDday, settleStreak,
    grid, monthIncome, monthExpense, categoryExpenses, latest,
  };
}

// 이번 달(또는 직전 달)부터 거꾸로 연속 결산 월 수
function countSettleStreak(settlements, currentMonth) {
  const months = new Set(settlements.map((st) => st.month));
  let cursor = months.has(currentMonth) ? currentMonth : prevMonthKey(currentMonth);
  let count = 0;
  while (months.has(cursor)) {
    count += 1;
    cursor = prevMonthKey(cursor);
  }
  return count;
}

function prevMonthKey(month) {
  const [year, m] = month.split("-").map(Number);
  return m === 1 ? `${year - 1}-12` : `${year}-${pad(m - 1)}`;
}

// 최근 12개월 롤링 그리드: [{month, status: done|low|miss|current}]
function buildGrid(settlements, currentMonth) {
  const byMonth = Object.fromEntries(settlements.map((st) => [st.month, st]));
  const deltasByMonth = {};
  const sorted = settlements.slice().sort((a, b) => (a.month < b.month ? -1 : 1));
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = Math.max(1, monthDiff(sorted[i - 1].month, sorted[i].month));
    deltasByMonth[sorted[i].month] = (sorted[i].total - sorted[i - 1].total) / gap;
  }
  const cells = [];
  let cursor = currentMonth;
  for (let i = 0; i < 12; i += 1) {
    const st = byMonth[cursor];
    let status = "miss";
    if (cursor === currentMonth && !st) status = "current";
    else if (st) {
      const delta = deltasByMonth[cursor];
      const target = Number(st.requiredSaving || 0);
      status = delta === undefined || delta >= target ? "done" : "low";
    }
    cells.unshift({ month: cursor, status });
    cursor = prevMonthKey(cursor);
  }
  return cells;
}

/* ---------- 렌더 ---------- */

function render() {
  const app = document.querySelector("#app");
  const metrics = getMetrics(state);
  app.innerHTML = `
    <section class="screen">
      ${renderScreen(metrics)}
    </section>
    ${renderNav()}
    ${state.hasOnboarded ? "" : renderOnboarding()}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;
  bindEvents(metrics);
}

function renderScreen(metrics) {
  if (state.activeTab === "record") return renderRecord(metrics);
  if (state.activeTab === "flow") return renderFlow(metrics);
  if (state.activeTab === "settings") return renderSettings(metrics);
  return renderReality(metrics);
}

function renderHeader() {
  const today = new Date();
  return `
    <div class="screen-header">
      <h1 class="title">1억</h1>
      <div class="date-pill">${today.getMonth() + 1}월 ${today.getDate()}일</div>
    </div>
  `;
}

function renderMissionCard(m) {
  if (m.monthBudget <= 0) {
    return `
      <section class="card mission-card">
        <div class="mission-head">
          <p class="mission-label">오늘 쓸 수 있는 돈</p>
        </div>
        <p class="mission-remaining num over">0<span class="unit">원</span></p>
        <p class="mission-warn">이 목표일은 현재 수입으로 어렵습니다. 설정에서 목표일 또는 월 수입을 조정해 주세요.</p>
      </section>
    `;
  }
  const remaining = m.todayResult.budget - m.todayResult.spent;
  const over = remaining < 0;
  const usedRate = m.todayResult.budget > 0 ? Math.min(100, (m.todayResult.spent / m.todayResult.budget) * 100) : 100;
  return `
    <section class="card mission-card">
      <div class="mission-head">
        <p class="mission-label">오늘 쓸 수 있는 돈</p>
        <span class="mission-streak">${m.streak > 0 ? `${m.streak}일 연속 ✓` : "오늘부터 시작"}</span>
      </div>
      <p class="mission-remaining num ${over ? "over" : ""}">${money(Math.abs(Math.round(remaining))).replace("원", "")}<span class="unit">${over ? "원 초과" : "원"}</span></p>
      <div class="progress-track"><div class="progress-fill" style="width:${100 - usedRate}%"></div></div>
      <p class="mission-sub num">예산 ${money(Math.round(m.todayResult.budget))} · 사용 ${money(m.todayResult.spent)}</p>
    </section>
  `;
}

function renderReality(m) {
  const arrivalText = m.arrival ? `${m.arrival.getFullYear()}년 ${m.arrival.getMonth() + 1}월` : "속도 부족";
  return `
    ${renderHeader()}
    ${renderMissionCard(m)}
    <section class="section quick-actions">
      <button class="action-button expense" data-open-transaction="expense">− 지출</button>
      <button class="action-button income" data-open-transaction="income">+ 수입</button>
    </section>
    <section class="section card">
      <p class="hero-label">1억까지 남은 금액</p>
      <h2 class="hero-money num">${readableMoney(m.remaining)}</h2>
      <p class="hero-sub num">현재 자산 ${readableMoney(m.netWorth)} · 지금 속도로 <b>${arrivalText}</b></p>
      <div class="progress-track"><div class="progress-fill plain" style="width:${m.progress}%"></div></div>
      <button class="basis-button" data-open-speed>${m.basisLabel}</button>
    </section>
    <section class="section card">
      <div class="settle-head">
        <p class="hero-label">${m.today.getMonth() + 1}월 결산</p>
        <span class="mission-streak">${m.settledThisMonth ? "완료 ✓" : `D-${m.settleDday}`}${m.settleStreak > 1 ? ` · ${m.settleStreak}개월 연속` : ""}</span>
      </div>
      <div class="settle-grid">
        ${m.grid.map((cell) => `<div class="settle-cell ${cell.status === "miss" ? "" : cell.status}" title="${cell.month}"></div>`).join("")}
      </div>
      ${
        m.settledThisMonth
          ? `<p class="settle-sub">이번 달 결산 완료 · 보고서는 흐름 탭에</p>`
          : `<button class="settle-cta" data-open-settle>${m.today.getMonth() + 1}월 결산하기 · 계좌 잔고 입력</button>`
      }
    </section>
  `;
}

function renderNav() {
  return `
    <nav class="bottom-nav" aria-label="하단 메뉴">
      ${tabs.map((tab) => `<button class="nav-button ${state.activeTab === tab.id ? "active" : ""}" data-tab="${tab.id}">${tab.label}</button>`).join("")}
    </nav>
  `;
}

/* ---------- 지출/수입 입력 시트 ---------- */

function openTransactionSheet(type) {
  const categories = type === "income" ? incomeCategories : expenseCategories;
  let selectedCategory = categories[0];
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">${type === "income" ? "수입 기록" : "지출 기록"}</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <form class="form-grid" data-transaction-form>
        <div class="field">
          <label for="amount">금액</label>
          <input id="amount" name="amount" inputmode="numeric" placeholder="예: 12000" autofocus />
        </div>
        <div class="field">
          <label>카테고리</label>
          <div class="chips">
            ${categories.map((name) => `<button class="chip ${name === selectedCategory ? "active" : ""}" type="button" data-pick-category="${name}">${name}</button>`).join("")}
          </div>
        </div>
        <details class="advanced-fields">
          <summary>메모·날짜</summary>
          <div class="field"><label for="title">메모</label><input id="title" name="title" /></div>
          <div class="field"><label for="date">날짜</label><input id="date" name="date" type="date" value="${localDateString(new Date())}" /></div>
        </details>
        <button class="primary-button" type="submit">저장</button>
      </form>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);
  modal.querySelector("#amount")?.focus();
  modal.querySelectorAll("[data-pick-category]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedCategory = button.dataset.pickCategory;
      modal.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("active"));
      button.classList.add("active");
    });
  });
  modal.querySelector("[data-transaction-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = numberFromInput(form.get("amount"));
    if (!amount) return;
    const transaction = {
      id: cryptoId(),
      type,
      amount,
      category: selectedCategory,
      title: String(form.get("title") || selectedCategory),
      date: String(form.get("date") || localDateString(new Date())),
      source: "manual",
    };
    const next = { ...state, transactions: [...state.transactions, transaction] };
    const after = getMetrics(next);
    let toast;
    if (type === "income") {
      toast = `수입 +${money(amount)} 기록했습니다.`;
    } else if (after.monthBudget <= 0) {
      toast = `지출 ${money(amount)} 저장했습니다.`;
    } else {
      const remaining = after.todayResult.budget - after.todayResult.spent;
      toast = remaining >= 0
        ? `저장 · 오늘 잔여 ${money(Math.round(remaining))}`
        : after.todayDay < after.dayResults.length
          ? `오늘 예산 초과 · 내일 ${money(Math.round(after.dayResults[after.todayDay].budget))}부터 다시`
          : `오늘 예산 초과 · 이번 달 마감`;
    }
    state = { ...next, toast };
    saveState();
    modal.remove();
    render();
    clearToastSoon();
  });
}

/* ---------- 유틸 ---------- */

function bindSheetClose(modal) {
  modal.querySelector("[data-close-sheet]").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
}

function money(value) {
  return `${Math.round(Number(value || 0)).toLocaleString("ko-KR")}원`;
}

function readableMoney(value) {
  const number = Math.round(Number(value || 0));
  const sign = number < 0 ? "-" : "";
  const absolute = Math.abs(number);
  const eok = Math.floor(absolute / 100000000);
  const man = Math.floor((absolute % 100000000) / 10000);
  const won = absolute % 10000;
  const parts = [];
  if (eok) parts.push(`${eok.toLocaleString("ko-KR")}억`);
  if (man) parts.push(`${man.toLocaleString("ko-KR")}만`);
  if (won || !parts.length) parts.push(`${won.toLocaleString("ko-KR")}원`);
  else parts[parts.length - 1] = `${parts[parts.length - 1]}원`;
  return `${sign}${parts.join(" ")}`;
}

function signedMoney(value) {
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function numberFromInput(value) {
  return Number(String(value || "").replace(/[^\d.-]/g, ""));
}

function cryptoId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function clearToastSoon() {
  window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2400);
}

/* ---------- 고정 항목 자동 기록 (v1에서 이어받음) ---------- */

function fixedTransactionId(item, month) {
  return `fixed-${item.id}-${month}`;
}

function dueDateForMonth(month, day) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, Math.min(day, daysInMonth(year, monthNumber)));
}

function getMonthRange(startMonth, endMonth) {
  const months = [];
  let cursor = startMonth;
  while (cursor <= endMonth) {
    months.push(cursor);
    const [year, m] = cursor.split("-").map(Number);
    cursor = m === 12 ? `${year + 1}-01` : `${year}-${pad(m + 1)}`;
  }
  return months;
}

function applyFixedItems(currentState) {
  const today = new Date();
  const existingIds = new Set(currentState.transactions.map((tx) => tx.id));
  const nextTransactions = [...currentState.transactions];
  currentState.fixedItems
    .filter((item) => item.active)
    .forEach((item) => {
      const start = item.startMonth || monthKey(today);
      getMonthRange(start, monthKey(today)).forEach((month) => {
        const dueDate = dueDateForMonth(month, item.day);
        if (dueDate > today) return;
        const id = fixedTransactionId(item, month);
        if (existingIds.has(id)) return;
        nextTransactions.push({
          id, type: item.type, amount: Number(item.amount || 0), category: item.category,
          title: item.name, date: localDateString(dueDate), source: "fixed", fixedItemId: item.id,
        });
        existingIds.add(id);
      });
    });
  return { ...currentState, transactions: nextTransactions };
}

/* ---------- 이벤트 바인딩 + 부트스트랩 ---------- */

function bindEvents(metrics) {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => setState((prev) => ({ ...prev, activeTab: button.dataset.tab })));
  });
  document.querySelectorAll("[data-open-transaction]").forEach((button) => {
    button.addEventListener("click", () => openTransactionSheet(button.dataset.openTransaction));
  });
  document.querySelector("[data-open-speed]")?.addEventListener("click", () => openSpeedSheet(metrics));
  document.querySelector("[data-open-settle]")?.addEventListener("click", () => openSettleSheet(metrics));
  bindOnboarding();
  bindRecordEvents();
  bindFlowEvents();
  bindSettingsEvents();
}

// Task 4-5에서 구현. 이 스텁 4개는 Task 5 완료 시 모두 실제 구현으로 대체되어야 한다.
function renderOnboarding() { return ""; }
function bindOnboarding() {}
function renderRecord() { return renderHeader(); }
function bindRecordEvents() {}
function renderFlow() { return renderHeader(); }
function bindFlowEvents() {}
function renderSettings() { return renderHeader(); }
function bindSettingsEvents() {}
function openSpeedSheet() {}
function openSettleSheet() {}

let state = applyFixedItems(loadState());
saveState();
render();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
```

- [ ] **Step 3: 문법 + 테스트 확인**

Run: `node --check app.js && node --check logic.js && node tests.js`
Expected: 에러 없음 + `all tests passed`

- [ ] **Step 4: 브라우저 스모크 테스트**

Run: `python3 -m http.server 4173` → http://localhost:4173 열기.
Expected: Void 다크 첫 화면. 계좌·결산이 없으므로 미션 카드는 "목표일 조정" 경고 상태(월수입 0), 1억 카드 "1억 원" 남음, 결산 카드에 "7월 결산하기" CTA(아직 무동작). 지출 저장 시 토스트 출력. 콘솔 에러 없음(sw.js 404는 Task 6 전까지 허용).

- [ ] **Step 5: 커밋**

```bash
git add app.js index.html
git commit -m "feat: 상태 v2 + 미션/1억/결산 현실 탭 + 입력 시트"
```

---

### Task 4: app.js 재작성 2/3 — 결산 시트 · 월간 보고서 · 계산 기준 시트

**Files:**
- Modify: `app.js` (Task 3의 스텁 `openSettleSheet`, `openSpeedSheet` 교체 + 신규 함수 추가)

- [ ] **Step 1: 스텁 `function openSpeedSheet() {}` / `function openSettleSheet() {}` 두 줄을 삭제**하고, `/* ---------- 이벤트 바인딩 + 부트스트랩 ---------- */` 주석 **위**에 아래 코드를 삽입:

```js
/* ---------- 계산 기준 시트 ---------- */

function openSpeedSheet(m) {
  const deltas = settlementDeltas(state.settlements).slice(-3);
  const arrivalText = m.arrival ? `${m.arrival.getFullYear()}년 ${m.arrival.getMonth() + 1}월` : "속도 부족";
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">계산 기준</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <p class="report-headline num">${arrivalText}</p>
      <p class="hero-sub">${m.basisLabel}</p>
      <div class="section">
        <div class="money-row"><span>1억까지 남은 금액</span><strong class="num">${readableMoney(m.remaining)}</strong></div>
        <div class="money-row"><span>계산에 쓴 월 저축액</span><strong class="num">${money(Math.round(m.speed.monthlySaving))}</strong></div>
        <div class="money-row"><span>목표 기준 필요 월저축</span><strong class="num">${money(Math.round(m.requiredSaving))}</strong></div>
      </div>
      ${
        deltas.length
          ? `<div class="section"><div class="section-title-row"><h3 class="section-title">최근 결산 델타</h3><span class="section-note">월평균 정규화</span></div>
             ${deltas.map((d) => `<div class="money-row"><span>월 저축</span><strong class="num ${d >= 0 ? "" : ""}">${signedMoney(Math.round(d))}</strong></div>`).join("")}</div>`
          : `<p class="empty-state">결산이 2번 쌓이면 실제 속도로 전환됩니다.</p>`
      }
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);
}

/* ---------- 결산 시트 ---------- */

function openSettleSheet(m) {
  const activeAccounts = state.accounts.filter((a) => a.active).sort((a, b) => a.order - b.order);
  if (!activeAccounts.length) {
    setState((prev) => ({ ...prev, activeTab: "settings", toast: "먼저 설정에서 계좌를 등록해 주세요." }));
    clearToastSoon();
    return;
  }
  const latest = m.latest;
  const prevBalance = (accountId) => {
    const found = latest?.balances?.find((b) => b.accountId === accountId);
    return found ? Number(found.amount) : "";
  };
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">${m.today.getMonth() + 1}월 결산 · 계좌 잔고</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <form class="form-grid" data-settle-form>
        ${activeAccounts
          .map(
            (account) => `
              <div class="account-row">
                <div>
                  <div class="name">${escapeHtml(account.name)}</div>
                  <div class="prev num">${prevBalance(account.id) === "" ? "이전 기록 없음" : `지난 결산 ${money(prevBalance(account.id))}`}</div>
                </div>
                <input inputmode="numeric" name="acc-${account.id}" value="${prevBalance(account.id)}" placeholder="잔고" />
              </div>
            `,
          )
          .join("")}
        <div class="settle-total"><span>합계</span><strong class="num" data-settle-total>0원</strong></div>
        <button class="primary-button" type="submit">결산 저장</button>
      </form>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);

  const form = modal.querySelector("[data-settle-form]");
  const totalEl = modal.querySelector("[data-settle-total]");
  const updateTotal = () => {
    const total = activeAccounts.reduce((sum, account) => sum + (numberFromInput(form.elements[`acc-${account.id}`].value) || 0), 0);
    totalEl.textContent = money(total);
    return total;
  };
  form.addEventListener("input", updateTotal);
  updateTotal();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const balances = activeAccounts.map((account) => ({
      accountId: account.id,
      amount: numberFromInput(form.elements[`acc-${account.id}`].value) || 0,
    }));
    const total = balances.reduce((sum, b) => sum + b.amount, 0);
    if (total <= 0) return;
    const settlement = {
      id: cryptoId(),
      month: m.currentMonth,
      date: localDateString(m.today),
      balances,
      total,
      requiredSaving: Math.round(m.requiredSaving),
      monthlyIncome: Number(state.settings.monthlyIncome || 0),
    };
    state = {
      ...state,
      // 같은 달 재결산은 교체
      settlements: [...state.settlements.filter((st) => st.month !== m.currentMonth), settlement],
      toast: "결산 저장 완료",
    };
    saveState();
    modal.remove();
    render();
    clearToastSoon();
    openReportSheet(settlement);
  });
}

/* ---------- 월간 보고서 ---------- */

function openReportSheet(settlement) {
  const others = state.settlements.filter((st) => st.month < settlement.month);
  const prev = others.slice().sort((a, b) => (a.month < b.month ? -1 : 1)).at(-1) || null;
  const gap = prev ? Math.max(1, monthDiff(prev.month, settlement.month)) : 0;
  const delta = prev ? (settlement.total - prev.total) / gap : null;
  const required = Number(settlement.requiredSaving || 0);
  const income = Number(settlement.monthlyIncome || 0);
  const m = getMetrics(state);
  const arrivalText = m.arrival ? `${m.arrival.getFullYear()}년 ${m.arrival.getMonth() + 1}월` : "속도 부족";
  const [year, monthNum] = settlement.month.split("-");

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">${Number(monthNum)}월 운용 보고서</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <p class="hero-label">${year}년 ${Number(monthNum)}월 자산</p>
      <p class="report-headline num">${readableMoney(settlement.total)}</p>
      ${
        prev
          ? `
            <div class="section">
              <div class="report-line"><span>지난 결산 대비</span><strong class="num">${signedMoney(Math.round(delta * gap))}${gap > 1 ? ` (${gap}개월)` : ""}</strong></div>
              <div class="report-line"><span>월평균 저축</span><strong class="num">${signedMoney(Math.round(delta))}</strong></div>
              <div class="report-line"><span>필요 월저축</span><strong class="num">${money(required)}</strong></div>
              ${income > 0 ? `<div class="report-line"><span>저축률</span><strong class="num">${((delta / income) * 100).toFixed(1)}%</strong></div>` : ""}
              <div class="report-line"><span>도착 예상</span><strong class="num">${arrivalText}</strong></div>
            </div>
            <p class="report-verdict ${delta >= required ? "" : "miss"}">
              ${delta >= required
                ? `목표 페이스 대비 ${signedMoney(Math.round(delta - required))} · 페이스 유지 중`
                : `목표 페이스까지 월 ${money(Math.round(required - delta))} 부족`}
            </p>
          `
          : `<p class="empty-state">첫 결산입니다. 다음 결산부터 증감과 페이스가 계산됩니다.</p>`
      }
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);
}
```

- [ ] **Step 2: 문법 확인**

Run: `node --check app.js`
Expected: 에러 없음

- [ ] **Step 3: 브라우저 확인**

localhost:4173 새로고침 → localStorage에 임시 계좌를 넣고 결산 흐름 확인:
개발자도구 콘솔에서
```js
let s = JSON.parse(localStorage.getItem("one_hundred_million_mobile_v2"));
s.accounts = [{ id: "a1", name: "토스뱅크", order: 0, active: true }, { id: "a2", name: "키움증권", order: 1, active: true }];
s.settings.monthlyIncome = 3200000; s.hasOnboarded = true;
localStorage.setItem("one_hundred_million_mobile_v2", JSON.stringify(s)); location.reload();
```
Expected: "결산하기" 탭 → 계좌 2행 입력 → 합계 실시간 갱신 → 저장 → 보고서 시트("첫 결산입니다") → 현실 탭 그리드 마지막 칸이 민트, "완료 ✓". 계산 기준 버튼 → 시트 열림.

- [ ] **Step 4: 커밋**

```bash
git add app.js
git commit -m "feat: 결산 시트 + 월간 보고서 + 계산 기준 시트"
```

---

### Task 5: app.js 재작성 3/3 — 흐름·기록·설정 탭 + 온보딩 + 계좌 관리 + 백업

**Files:**
- Modify: `app.js` (Task 3의 남은 스텁 8개 전부 교체)

- [ ] **Step 1: 스텁 8개 삭제** — `renderOnboarding`, `bindOnboarding`, `renderRecord`, `bindRecordEvents`, `renderFlow`, `bindFlowEvents`, `renderSettings`, `bindSettingsEvents` 스텁 줄과 그 위의 `// Task 4-5에서 구현...` 주석 삭제. 그 자리에 아래 코드 삽입:

```js
/* ---------- 기록 탭 ---------- */

function renderRecord(m) {
  const recent = state.transactions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 20);
  return `
    ${renderHeader()}
    <section class="quick-actions">
      <button class="action-button expense" data-open-transaction="expense">− 지출</button>
      <button class="action-button income" data-open-transaction="income">+ 수입</button>
    </section>
    <section class="section card">
      <div class="section-title-row"><h2 class="section-title">입력 후 현실</h2><span class="section-note">즉시 반영</span></div>
      <div class="money-row"><span>오늘 잔여</span><strong class="num">${m.monthBudget > 0 ? money(Math.round(m.todayResult.budget - m.todayResult.spent)) : "—"}</strong></div>
      <div class="money-row"><span>1억까지</span><strong class="num">${readableMoney(m.remaining)}</strong></div>
      <div class="money-row"><span>도착 예상</span><strong class="num">${m.arrival ? `${m.arrival.getFullYear()}년 ${m.arrival.getMonth() + 1}월` : "속도 부족"}</strong></div>
    </section>
    <section class="section">
      <div class="section-title-row"><h2 class="section-title">최근 기록</h2><span class="section-note">${state.transactions.length}건</span></div>
      ${
        recent.length
          ? `<div class="transaction-list">${recent
              .map(
                (tx) => `
                  <article class="transaction-item">
                    <div>
                      <p class="item-title">${escapeHtml(tx.title || tx.category)}</p>
                      <p class="item-sub">${tx.date.slice(5).replace("-", ".")} · ${escapeHtml(tx.category)}${tx.source === "fixed" ? " · 자동" : ""}</p>
                    </div>
                    <div>
                      <div class="item-amount num ${tx.type}">${tx.type === "income" ? "+" : "-"}${money(tx.amount)}</div>
                      ${tx.source === "fixed" ? "" : `<button class="ghost-button" data-delete-transaction="${tx.id}">삭제</button>`}
                    </div>
                  </article>`,
              )
              .join("")}</div>`
          : `<div class="card empty-state">아직 기록이 없습니다.</div>`
      }
    </section>
  `;
}

function bindRecordEvents() {
  document.querySelectorAll("[data-delete-transaction]").forEach((button) => {
    button.addEventListener("click", () => {
      setState((prev) => ({
        ...prev,
        transactions: prev.transactions.filter((tx) => tx.id !== button.dataset.deleteTransaction),
        toast: "기록을 삭제했습니다.",
      }));
      clearToastSoon();
    });
  });
}

/* ---------- 흐름 탭 (보고서 보관함) ---------- */

function renderFlow(m) {
  const sorted = state.settlements.slice().sort((a, b) => (a.month < b.month ? 1 : -1));
  const deltas = settlementDeltas(state.settlements);
  const recentDeltas = deltas.slice(-6);
  const maxDelta = Math.max(...recentDeltas.map((d) => Math.abs(d)), 1);
  const categories = Object.entries(m.categoryExpenses).sort((a, b) => b[1] - a[1]);
  const maxCategory = Math.max(...categories.map(([, v]) => v), 1);
  return `
    ${renderHeader()}
    <section class="card">
      <div class="section-title-row"><h2 class="section-title">월간 보고서</h2><span class="section-note">${sorted.length}건</span></div>
      ${
        sorted.length
          ? sorted
              .map((st) => {
                const [, monthNum] = st.month.split("-");
                return `<button class="money-row" style="width:100%" data-open-report="${st.month}">
                  <span>${st.month.slice(0, 4)}년 ${Number(monthNum)}월</span>
                  <strong class="num">${readableMoney(st.total)}</strong>
                </button>`;
              })
              .join("")
          : `<div class="empty-state">첫 결산을 하면 보고서가 쌓입니다.</div>`
      }
    </section>
    <section class="section card">
      <div class="section-title-row"><h2 class="section-title">저축 추세</h2><span class="section-note">결산 델타 · 월평균</span></div>
      ${
        recentDeltas.length
          ? recentDeltas
              .map(
                (d) => `
                  <div class="bar-row">
                    <div class="bar-label num">${signedMoney(Math.round(d)).slice(0, 1)}</div>
                    <div class="bar-track"><div class="bar-fill ${d >= 0 ? "" : "negative"}" style="width:${Math.min(100, (Math.abs(d) / maxDelta) * 100)}%"></div></div>
                    <div class="bar-value num">${signedMoney(Math.round(d))}</div>
                  </div>`,
              )
              .join("")
          : `<div class="empty-state">결산 2건부터 추세가 보입니다.</div>`
      }
    </section>
    <section class="section">
      <div class="section-title-row"><h2 class="section-title">이번 달 지출</h2><span class="section-note">카테고리</span></div>
      ${
        categories.length
          ? `<div class="category-list">${categories
              .map(
                ([name, amount]) => `
                  <article class="card category-card">
                    <div class="category-top"><strong>${escapeHtml(name)}</strong><strong class="num">${money(amount)}</strong></div>
                    <div class="mini-track"><div class="mini-fill" style="width:${Math.min(100, (amount / maxCategory) * 100)}%"></div></div>
                  </article>`,
              )
              .join("")}</div>`
          : `<div class="card empty-state">이번 달 지출 기록이 없습니다.</div>`
      }
    </section>
  `;
}

function bindFlowEvents() {
  document.querySelectorAll("[data-open-report]").forEach((button) => {
    button.addEventListener("click", () => {
      const settlement = state.settlements.find((st) => st.month === button.dataset.openReport);
      if (settlement) openReportSheet(settlement);
    });
  });
}

/* ---------- 설정 탭 ---------- */

function renderSettings(m) {
  const accounts = state.accounts.slice().sort((a, b) => a.order - b.order);
  return `
    ${renderHeader()}
    <div class="form-grid">
      <section class="card">
        <div class="section-title-row"><h2 class="section-title">목표</h2><span class="section-note num">현재 ${m.progress.toFixed(1)}%</span></div>
        <form class="form-grid" data-settings-form>
          <div class="field"><label for="targetAmount">목표 금액</label><input id="targetAmount" name="targetAmount" inputmode="numeric" value="${state.settings.targetAmount}" /></div>
          <div class="two-col">
            <div class="field"><label for="targetDate">목표일</label><input id="targetDate" name="targetDate" type="date" value="${state.settings.targetDate}" /></div>
            <div class="field"><label for="monthlyIncome">월 수입</label><input id="monthlyIncome" name="monthlyIncome" inputmode="numeric" value="${state.settings.monthlyIncome}" /></div>
          </div>
          <button class="primary-button" type="submit">목표 저장</button>
        </form>
      </section>
      <section class="card">
        <div class="section-title-row"><h2 class="section-title">계좌</h2><span class="section-note">${accounts.filter((a) => a.active).length}개 활성</span></div>
        ${accounts
          .map(
            (account) => `
              <div class="money-row">
                <span>${escapeHtml(account.name)}${account.active ? "" : " · 꺼짐"}</span>
                <span>
                  <button class="ghost-button" data-toggle-account="${account.id}">${account.active ? "끄기" : "켜기"}</button>
                  <button class="ghost-button" data-rename-account="${account.id}">이름</button>
                  <button class="ghost-button" data-delete-account="${account.id}">삭제</button>
                </span>
              </div>`,
          )
          .join("")}
        <button class="secondary-button" data-add-account>계좌 추가</button>
      </section>
      <section class="card">
        <div class="section-title-row"><h2 class="section-title">고정 항목</h2><span class="section-note">매달 자동 기록</span></div>
        ${state.fixedItems
          .map(
            (item) => `
              <div class="money-row">
                <span>${escapeHtml(item.name)} · 매월 ${item.day}일${item.active ? "" : " · 꺼짐"}</span>
                <span>
                  <strong class="num">${item.type === "income" ? "+" : "-"}${money(item.amount)}</strong>
                  <button class="ghost-button" data-toggle-fixed="${item.id}">${item.active ? "끄기" : "켜기"}</button>
                  <button class="ghost-button" data-delete-fixed="${item.id}">삭제</button>
                </span>
              </div>`,
          )
          .join("")}
        <button class="secondary-button" data-open-fixed>고정 항목 추가</button>
      </section>
      <section class="card">
        <div class="section-title-row"><h2 class="section-title">데이터</h2><span class="section-note">이 기기에 저장</span></div>
        <div class="button-row">
          <button class="secondary-button" data-export-data>백업</button>
          <button class="secondary-button" data-import-data>복원</button>
        </div>
        <input class="hidden-file" type="file" accept="application/json,.json" data-import-file />
        <div class="section"><button class="danger-button" data-reset-all>전체 초기화</button></div>
      </section>
    </div>
  `;
}

function bindSettingsEvents() {
  document.querySelector("[data-settings-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        targetAmount: numberFromInput(form.get("targetAmount")),
        targetDate: String(form.get("targetDate")),
        monthlyIncome: numberFromInput(form.get("monthlyIncome")),
      },
      toast: "목표를 저장했습니다.",
    }));
    clearToastSoon();
  });

  document.querySelector("[data-add-account]")?.addEventListener("click", () => {
    const name = window.prompt("계좌 이름 (예: 토스뱅크)");
    if (!name?.trim()) return;
    setState((prev) => ({
      ...prev,
      accounts: [...prev.accounts, { id: cryptoId(), name: name.trim(), order: prev.accounts.length, active: true }],
      toast: "계좌를 추가했습니다.",
    }));
    clearToastSoon();
  });
  document.querySelectorAll("[data-rename-account]").forEach((button) => {
    button.addEventListener("click", () => {
      const account = state.accounts.find((a) => a.id === button.dataset.renameAccount);
      const name = window.prompt("새 이름", account?.name || "");
      if (!name?.trim()) return;
      setState((prev) => ({
        ...prev,
        accounts: prev.accounts.map((a) => (a.id === button.dataset.renameAccount ? { ...a, name: name.trim() } : a)),
      }));
    });
  });
  document.querySelectorAll("[data-toggle-account]").forEach((button) => {
    button.addEventListener("click", () => {
      setState((prev) => ({
        ...prev,
        accounts: prev.accounts.map((a) => (a.id === button.dataset.toggleAccount ? { ...a, active: !a.active } : a)),
      }));
    });
  });
  document.querySelectorAll("[data-delete-account]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!window.confirm("계좌를 삭제할까요? 과거 결산 기록은 유지됩니다.")) return;
      setState((prev) => ({
        ...prev,
        accounts: prev.accounts.filter((a) => a.id !== button.dataset.deleteAccount),
      }));
    });
  });

  document.querySelector("[data-open-fixed]")?.addEventListener("click", openFixedSheet);
  document.querySelectorAll("[data-toggle-fixed]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = {
        ...state,
        fixedItems: state.fixedItems.map((item) => (item.id === button.dataset.toggleFixed ? { ...item, active: !item.active } : item)),
      };
      state = applyFixedItems(next);
      saveState();
      render();
    });
  });
  document.querySelectorAll("[data-delete-fixed]").forEach((button) => {
    button.addEventListener("click", () => {
      setState((prev) => ({
        ...prev,
        fixedItems: prev.fixedItems.filter((item) => item.id !== button.dataset.deleteFixed),
      }));
    });
  });

  document.querySelector("[data-export-data]")?.addEventListener("click", exportData);
  document.querySelector("[data-import-data]")?.addEventListener("click", () => document.querySelector("[data-import-file]")?.click());
  document.querySelector("[data-import-file]")?.addEventListener("change", importData);
  document.querySelector("[data-reset-all]")?.addEventListener("click", () => {
    if (!window.confirm("모든 데이터를 지우고 처음부터 시작할까요?")) return;
    localStorage.removeItem(STORE_KEY);
    state = defaultState();
    saveState();
    render();
  });
}

/* ---------- 고정 항목 추가 시트 (v1 이어받음, 스타일만 v2) ---------- */

function openFixedSheet() {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">고정 항목 추가</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <form class="form-grid" data-fixed-form>
        <div class="field"><label for="fixedName">이름</label><input id="fixedName" name="name" placeholder="예: 월급, 월세, 통신비" /></div>
        <div class="two-col">
          <div class="field"><label for="fixedType">종류</label>
            <select id="fixedType" name="type"><option value="expense">지출</option><option value="income">수입</option></select>
          </div>
          <div class="field"><label for="fixedDay">매월</label>
            <select id="fixedDay" name="day">${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}일</option>`).join("")}</select>
          </div>
        </div>
        <div class="field"><label for="fixedAmount">금액</label><input id="fixedAmount" name="amount" inputmode="numeric" placeholder="예: 500000" /></div>
        <div class="field"><label for="fixedCategory">카테고리</label><input id="fixedCategory" name="category" value="고정비" /></div>
        <button class="primary-button" type="submit">저장</button>
      </form>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);
  modal.querySelector("[data-fixed-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = numberFromInput(form.get("amount"));
    const name = String(form.get("name") || "").trim();
    if (!amount || !name) return;
    const item = {
      id: cryptoId(), type: String(form.get("type")), name, amount,
      day: Number(form.get("day")), category: String(form.get("category") || "기타").trim(),
      active: true, startMonth: monthKey(new Date()),
    };
    state = applyFixedItems({ ...state, fixedItems: [...state.fixedItems, item], toast: "고정 항목을 저장했습니다." });
    saveState();
    modal.remove();
    render();
    clearToastSoon();
  });
}

/* ---------- 백업/복원 ---------- */

function exportData() {
  const { toast, ...persisted } = state;
  const payload = { app: "1억 모으기", version: 2, exportedAt: new Date().toISOString(), data: persisted };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `1억모으기-백업-${localDateString(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  state.toast = "백업 파일을 만들었습니다.";
  render();
  clearToastSoon();
}

async function importData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const data = parsed.data || parsed;
    if (Array.isArray(data.settlements)) {
      // v2 백업
      state = applyFixedItems({ ...defaultState(), ...data, settings: { ...defaultState().settings, ...data.settings }, toast: "백업을 복원했습니다." });
    } else {
      // v1 백업: 거래·고정항목·목표만 이관, 계좌/결산은 온보딩으로
      state = applyFixedItems({
        ...defaultState(),
        transactions: data.transactions || [],
        fixedItems: data.fixedItems || [],
        settings: {
          ...defaultState().settings,
          targetAmount: data.settings?.targetAmount || 100000000,
          targetDate: data.settings?.targetDate || "2030-12-31",
        },
        hasOnboarded: false,
        toast: "v1 백업에서 기록을 가져왔습니다. 계좌를 등록해 주세요.",
      });
    }
    saveState();
    render();
    clearToastSoon();
  } catch {
    state.toast = "복원할 수 없는 파일입니다.";
    render();
    clearToastSoon();
  } finally {
    event.target.value = "";
  }
}

/* ---------- 온보딩 ---------- */

function renderOnboarding() {
  return `
    <div class="modal-backdrop onboarding-backdrop">
      <section class="sheet onboarding-sheet" role="dialog" aria-modal="true">
        <div class="sheet-header"><h2 class="sheet-title">3분 세팅</h2></div>
        <p class="onboarding-copy">계좌 잔고만 넣으면 오늘의 미션이 바로 계산됩니다.</p>
        <form class="form-grid" data-onboarding-form>
          <div class="field"><label>계좌와 현재 잔고</label>
            <div class="form-grid" data-onboard-accounts>
              <div class="account-row"><input name="accName" placeholder="계좌 이름 (예: 토스뱅크)" /><input name="accAmount" inputmode="numeric" placeholder="잔고" /></div>
              <div class="account-row"><input name="accName" placeholder="계좌 이름 (예: 키움증권)" /><input name="accAmount" inputmode="numeric" placeholder="잔고" /></div>
            </div>
            <button class="ghost-button" type="button" data-add-onboard-account>+ 계좌 더 추가</button>
          </div>
          <div class="two-col">
            <div class="field"><label for="obTarget">목표 금액</label><input id="obTarget" name="targetAmount" inputmode="numeric" value="100000000" /></div>
            <div class="field"><label for="obDate">목표일</label><input id="obDate" name="targetDate" type="date" value="2030-12-31" /></div>
          </div>
          <div class="two-col">
            <div class="field"><label for="obIncome">월 수입</label><input id="obIncome" name="monthlyIncome" inputmode="numeric" placeholder="예: 3200000" /></div>
            <div class="field"><label for="obFixed">월 고정지출 합(선택)</label><input id="obFixed" name="fixedExpense" inputmode="numeric" placeholder="예: 900000" /></div>
          </div>
          <button class="primary-button" type="submit">시작하기</button>
        </form>
      </section>
    </div>
  `;
}

function bindOnboarding() {
  document.querySelector("[data-add-onboard-account]")?.addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "account-row";
    row.innerHTML = `<input name="accName" placeholder="계좌 이름" /><input name="accAmount" inputmode="numeric" placeholder="잔고" />`;
    document.querySelector("[data-onboard-accounts]")?.appendChild(row);
  });

  document.querySelector("[data-onboarding-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formEl = event.currentTarget;
    const today = new Date();
    const names = [...formEl.querySelectorAll('input[name="accName"]')].map((el) => el.value.trim());
    const amounts = [...formEl.querySelectorAll('input[name="accAmount"]')].map((el) => numberFromInput(el.value) || 0);
    const accounts = [];
    const balances = [];
    names.forEach((name, index) => {
      if (!name) return;
      const id = cryptoId();
      accounts.push({ id, name, order: accounts.length, active: true });
      balances.push({ accountId: id, amount: amounts[index] });
    });
    if (!accounts.length) return;

    const form = new FormData(formEl);
    const targetAmount = numberFromInput(form.get("targetAmount")) || 100000000;
    const targetDate = String(form.get("targetDate") || "2030-12-31");
    const monthlyIncome = numberFromInput(form.get("monthlyIncome")) || 0;
    const fixedExpense = numberFromInput(form.get("fixedExpense")) || 0;
    const total = balances.reduce((sum, b) => sum + b.amount, 0);
    const requiredSaving = requiredMonthlySaving(targetAmount, total, targetDate, today);

    const fixedItems = [];
    if (monthlyIncome > 0) fixedItems.push({ id: cryptoId(), type: "income", name: "월급", amount: monthlyIncome, day: 25, category: "급여", active: true, startMonth: monthKey(today) });
    if (fixedExpense > 0) fixedItems.push({ id: cryptoId(), type: "expense", name: "고정비", amount: fixedExpense, day: 1, category: "고정비", active: true, startMonth: monthKey(today) });

    state = applyFixedItems({
      ...defaultState(),
      hasOnboarded: true,
      settings: { targetAmount, targetDate, monthlyIncome, startDate: localDateString(today) },
      accounts,
      settlements: [{
        id: cryptoId(), month: monthKey(today), date: localDateString(today),
        balances, total, requiredSaving: Math.round(requiredSaving), monthlyIncome,
      }],
      fixedItems,
      toast: "내 숫자로 시작합니다.",
    });
    saveState();
    render();
    clearToastSoon();
  });
}
```

- [ ] **Step 2: 문법 + 테스트**

Run: `node --check app.js && node tests.js`
Expected: 에러 없음, `all tests passed`

- [ ] **Step 3: 브라우저 전체 흐름 확인** — localStorage 초기화 후:

콘솔에서 `localStorage.clear(); location.reload();`
Expected: 온보딩 시트 → 계좌 2개 + 잔고, 월수입 3200000, 고정지출 900000 입력 → 시작하기 → 미션 카드에 오늘 예산 숫자(양수), 결산 카드 마지막 칸 민트 "완료 ✓" → 지출 12000 저장 → 토스트 "저장 · 오늘 잔여 …" → 흐름 탭에 보고서 1건 → 설정 탭에서 계좌·고정항목 보임 → 새로고침 후 상태 유지 → 백업 다운로드 → 전체 초기화 → 복원으로 되돌아옴.

- [ ] **Step 4: 커밋**

```bash
git add app.js
git commit -m "feat: 흐름·기록·설정 탭 + 온보딩 + 계좌 관리 + 백업 v2"
```

---

### Task 6: PWA — 아이콘 · manifest · 서비스워커 · iOS 메타

**Files:**
- Create: `icons/icon.svg`, `icons/icon-512.png`, `icons/icon-192.png`, `icons/icon-180.png`
- Create: `sw.js`
- Modify: `manifest.json`, `index.html`

- [ ] **Step 1: `icons/icon.svg` 생성**

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0.12" stop-color="#ffffff"/>
      <stop offset="0.88" stop-color="#3ce8a4"/>
    </linearGradient>
    <radialGradient id="bg" cx="0.25" cy="0.15" r="1.2">
      <stop offset="0" stop-color="#16191f"/>
      <stop offset="0.65" stop-color="#0b0d10"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <text x="256" y="272" text-anchor="middle" font-family="-apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif" font-size="185" font-weight="900" letter-spacing="-6" fill="url(#g)">1억</text>
</svg>
```

- [ ] **Step 2: PNG 생성 (macOS 내장 도구만 사용)**

```bash
mkdir -p icons
qlmanage -t -s 512 -o icons icons/icon.svg && mv icons/icon.svg.png icons/icon-512.png
sips -z 192 192 icons/icon-512.png --out icons/icon-192.png
sips -z 180 180 icons/icon-512.png --out icons/icon-180.png
sips -g pixelWidth icons/icon-512.png
```
Expected: `pixelWidth: 512`. qlmanage가 SVG 렌더링에 실패하면(빈 이미지) 대안: `open icons/icon.svg`로 브라우저에서 확인 후 Chrome 스크린샷 캡처, 또는 `rsvg-convert -w 512 icons/icon.svg -o icons/icon-512.png`(설치돼 있으면). 생성된 PNG를 열어 "1억" 그라데이션이 보이는지 확인.

- [ ] **Step 3: manifest.json 전체 교체**

```json
{
  "name": "1억 모으기",
  "short_name": "1억",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#0b0d10",
  "theme_color": "#0b0d10",
  "orientation": "portrait",
  "icons": [
    { "src": "./icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "./icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

- [ ] **Step 4: sw.js 생성**

```js
const CACHE = "eok-v1"; // 배포마다 버전 올리기
const ASSETS = [
  "./", "./index.html", "./styles.css", "./logic.js", "./app.js",
  "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));
});
```

- [ ] **Step 5: index.html `<head>`에 추가** (theme-color는 `#0b0d10`으로 교체)

```html
<meta name="theme-color" content="#0b0d10" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="1억" />
<link rel="apple-touch-icon" href="./icons/icon-180.png" />
```

- [ ] **Step 6: 확인**

localhost:4173에서 개발자도구 → Application → Manifest에 이름·아이콘 표시, Service Worker "activated". 콘솔 404 없음.

- [ ] **Step 7: 커밋**

```bash
git add icons/ sw.js manifest.json index.html
git commit -m "feat: PWA 완성 — 1억 아이콘, 서비스워커, iOS 메타"
```

---

### Task 7: 문서 갱신 — CLAUDE.md · README.md

**Files:**
- Modify: `CLAUDE.md` — 아래 절만 교체(나머지 유지):
  - "최우선 제품 원칙"에 3레이어(미션·기록·결산)와 "정직한 보상만" 원칙 반영
  - "첫 화면 유지 원칙" 목록을 새 구성으로: 미션 카드(오늘 쓸 수 있는 돈·스트릭) / − 지출 · + 수입 / 1억까지 남은 금액·현재 자산·도착 예상 / 결산 카드(D-day·롤링 12개월 그리드)
  - "속도 계산 원칙"을 결산 델타(월평균 정규화) 우선 → 목표 페이스 가정 라벨로 교체
  - "변동자산 원칙" 절 삭제 → "결산 원칙" 절 신설(계좌별 잔고, 월 1회, 같은 달 재결산 교체, requiredSaving 스냅샷)
  - "스타일 방향"에 Void 토큰(#0b0d10 / #12151a / #22262e / #f2f4f7 / #8b93a1 / #3ce8a4), 글로우·이모지·과장 문구 금지 명시
  - "기술 구조" 파일 목록에 logic.js, sw.js, icons/ 추가. "테스트: node tests.js" 명시
- Modify: `README.md` — 핵심 기능 절을 3레이어 설명으로 교체, 실행 방법에 `node tests.js` 추가, 배포 URL(Task 8 이후) 기입

- [ ] **Step 1: 위 내용대로 두 문서 수정**
- [ ] **Step 2: 커밋**

```bash
git add CLAUDE.md README.md
git commit -m "docs: 3레이어 구조·Void 테마 반영"
```

---

### Task 8: GitHub Pages 배포

- [ ] **Step 1: gh 인증 확인**

Run: `gh auth status`
Expected: `Logged in to github.com`. 아니면 사용자에게 `gh auth login` 요청하고 중단.

- [ ] **Step 2: 저장소 생성 + push**

```bash
cd /Users/choiyoung/dev/1억모으기
gh repo create 1eok --public --source=. --remote=origin --push
```
Expected: `https://github.com/<user>/1eok` 생성, main push 완료.

- [ ] **Step 3: Pages 활성화**

```bash
OWNER=$(gh api user -q .login)
gh api -X POST "repos/$OWNER/1eok/pages" -f 'source[branch]=main' -f 'source[path]=/'
```
Expected: HTTP 201. 이미 활성화면 409 — 무시.

- [ ] **Step 4: 배포 확인 (빌드 1~2분 대기)**

```bash
sleep 90 && curl -s -o /dev/null -w "%{http_code}" "https://$OWNER.github.io/1eok/"
```
Expected: `200`. 아니면 30초 후 재시도(최대 5회).

- [ ] **Step 5: README에 배포 URL 기입 + 커밋 + push**

```bash
git add README.md && git commit -m "docs: 배포 URL" && git push
```

- [ ] **Step 6: 사용자에게 폰 설치 안내 출력**

아이폰: Safari로 `https://<user>.github.io/1eok/` 접속 → 공유 버튼 → "홈 화면에 추가".
안드로이드: Chrome 접속 → 메뉴 → "홈 화면에 추가"(또는 설치 배너).

---

### Task 9: 최종 검증

- [ ] **Step 1: 전체 테스트** — `node --check app.js && node --check logic.js && node --check sw.js && node tests.js` 모두 통과
- [ ] **Step 2: 수동 시나리오 재실행** (Task 5 Step 3 흐름을 배포 URL에서 반복): 온보딩 → 지출 → 미션 갱신 → 결산 → 보고서 → 그리드 → 새로고침 유지 → 백업/복원
- [ ] **Step 3: 확인 사항 보고** — 실패 항목이 있으면 사용자에게 그대로 보고(숨기지 않기)

---

## Self-Review 결과

- **스펙 커버리지**: 3레이어 ✓(T3-5) / 재분배 미션·판정·스트릭 ✓(T1,T3) / 결산 갭 정규화 ✓(T1) / requiredSaving·monthlyIncome 스냅샷 ✓(T4 결산 저장, T3 grid 판정) / 롤링 12개월 그리드 ✓(T3) / 보고서 ✓(T4) / Void 테마 ✓(T2) / 아이콘 ✓(T6) / PWA ✓(T6) / 온보딩=첫 결산 ✓(T5) / v1 백업 이관 ✓(T5) / OCR·죽은 코드 제거 ✓(전면 재작성으로 소멸) / CLAUDE.md 갱신 ✓(T7) / 배포 ✓(T8)
- **미션 스트릭 범위**: 이번 달 내 연속만 계산(스펙에 월 경계 규칙 없음 — 구현 단순화, 첫 화면 라벨도 "N일 연속"이라 자연스러움)
- **타입 일관성**: settlement 필드(month/date/balances/total/requiredSaving/monthlyIncome)가 T1 테스트, T3 grid, T4 저장·보고서, T5 온보딩에서 동일 ✓ / `dailyBudgets(monthBudget, spendByDay, daysTotal)` 시그니처 T1=T3 ✓ / 스텁 8개는 T4-5에서 전부 실제 구현으로 교체 ✓

