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

// 월말 클램프 + 윤년
eq("addMonths month-end clamp", L.localDateString(L.addMonths(new Date(2026, 0, 31), 1)), "2026-02-28");
eq("addMonths leap year", L.localDateString(L.addMonths(new Date(2024, 0, 31), 1)), "2024-02-29");
eq("daysInMonth leap Feb", L.daysInMonth(2024, 2), 29);
// monthsBetween: 도착일의 일(day)이 시작일보다 앞서면 한 달 덜 침
eq("monthsBetween partial month", L.monthsBetween(new Date(2026, 6, 13), new Date(2026, 8, 12)), 1);

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
const streakDays = L.dailyBudgets(310000, { 4: 20000, 5: 3000, 7: 3000 }, 31);
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
// savingSpeed는 델타를 최근 3개로 제한
eq("speed caps at 3 deltas", L.savingSpeed([
  { month: "2026-01", total: 10 }, { month: "2026-02", total: 20 },
  { month: "2026-03", total: 30 }, { month: "2026-04", total: 40 },
  { month: "2026-05", total: 50 },
], 0).deltaCount, 3);

// 현재 자산 = 최신 결산 총액 + 결산일 이후 거래 순액 (결산 당일 거래는 제외)
const txs = [
  { type: "income", amount: 3200000, date: "2026-07-25", source: "fixed" },
  { type: "expense", amount: 12000, date: "2026-07-13", source: "manual" },
  { type: "expense", amount: 99999, date: "2026-06-30", source: "manual" }, // 결산 당일 → 제외
];
eq("netWorth", L.currentNetWorth({ date: "2026-06-30", total: 25000000 }, txs), 25000000 + 3200000 - 12000);

// 저축은 계좌 간 이체라 순자산에 영향 없음 (지출처럼 빠지면 안 된다)
const savingTxs = [
  { type: "saving", amount: 500000, date: "2026-07-25", source: "manual" },
  { type: "expense", amount: 12000, date: "2026-07-25", source: "manual" },
];
eq("netWorth ignores saving", L.currentNetWorth({ date: "2026-06-30", total: 25000000 }, savingTxs), 25000000 - 12000);

// 저축 진행: 채운 금액 / 목표
const sp = L.savingProgress(1000000, 1300000);
eq("savingProgress fields", [sp.saved, sp.target, sp.remaining, sp.done], [1000000, 1300000, 300000, false]);
approx("savingProgress pct", sp.pct, 76.923, 0.01);
eq("savingProgress done", L.savingProgress(1300000, 1300000).done, true);
eq("savingProgress over done", L.savingProgress(1500000, 1300000).done, true);
eq("savingProgress no target", L.savingProgress(50000, 0), { saved: 50000, target: 0, remaining: 0, pct: 0, done: false });

// 도착 예상일
eq("arrival", L.localDateString(L.arrivalDate(7342000, 1500000, today)).slice(0, 7), "2026-12"); // ceil(4.89)=5개월
eq("arrival none", L.arrivalDate(7342000, 0, today), null);

// 카테고리 추가 검증: 공백 정리 후 빈값·8자 초과·중복이면 null
eq("category valid", L.validateNewCategory(" 데이트 ", ["식비", "기타"]), "데이트");
eq("category collapses spaces", L.validateNewCategory("배달  음식", ["식비"]), "배달 음식");
eq("category empty", L.validateNewCategory("   ", ["식비"]), null);
eq("category too long", L.validateNewCategory("아주아주긴카테고리", ["식비"]), null); // 9자
eq("category duplicate", L.validateNewCategory("식비", ["식비", "기타"]), null);
eq("category duplicate after trim", L.validateNewCategory(" 식비 ", ["식비"]), null);

// 카테고리 이름 변경: 과거 거래·고정 항목의 category를 함께 이관
const renamed = L.renameCategoryInRecords(
  [{ id: "t1", category: "데이트" }, { id: "t2", category: "식비" }],
  [{ id: "f1", category: "데이트" }],
  "데이트", "연애"
);
eq("rename tx migrated", renamed.transactions.map((t) => t.category), ["연애", "식비"]);
eq("rename fixed migrated", renamed.fixedItems[0].category, "연애");
eq("rename keeps other fields", renamed.transactions[0].id, "t1");
// type을 주면 그 타입의 거래·고정 항목만 이관 (지출 "기타"와 수입 "기타"가 공존해도 안전)
const typedRename = L.renameCategoryInRecords(
  [{ id: "t1", type: "expense", category: "기타" }, { id: "t2", type: "income", category: "기타" }],
  [{ id: "f1", type: "income", category: "기타" }],
  "기타", "환급", "income",
);
eq("rename scoped by type", [
  typedRename.transactions[0].category, typedRename.transactions[1].category, typedRename.fixedItems[0].category,
], ["기타", "환급", "환급"]);

// 늦은 시작: startDay 이전 날들은 하루 몫을 소진한 것으로 처리 (1일 시작 기준)
const lateStart = L.dailyBudgets(310000, {}, 31, 20);
approx("late start day20 = month share", lateStart[19].budget, 10000);
approx("late start pre-start shows share", lateStart[0].budget, 10000);
eq("late start pre-start unjudged", [lateStart[0].judged, lateStart[0].clear], [false, false]);
// 시작일 이후 재분배는 정상 동작: 20일 15,000 지출 → 21일 = (310000-190000-15000)/11
approx("late start redistribution", L.dailyBudgets(310000, { 20: 15000 }, 31, 20)[20].budget, (310000 - 190000 - 15000) / 11);
// 시작 전 기록이 몫보다 크면 그 기록을 소진액으로 (max)
approx("late start pre-start big spend", L.dailyBudgets(310000, { 1: 50000 }, 31, 20)[19].budget, (310000 - 50000 - 18 * 10000) / 12);
// startDay 생략 시 기존 동작 유지 (하위 호환)
approx("late start default compat", L.dailyBudgets(310000, {}, 31)[19].budget, 310000 / 12);
// 시작 전 날들은 스트릭 대상 아님
eq("late start streak skips pre-start", L.missionStreak(L.dailyBudgets(310000, { 20: 5000 }, 31, 20), 20), 1);

// 포트폴리오 비중: 잔고>0만, 금액 내림차순, % 합 100, 초과분은 '기타' 합산
const pfAccounts = [
  { id: "a", name: "국민은행" }, { id: "b", name: "키움증권" }, { id: "c", name: "업비트" },
];
const pfShares = L.portfolioShares(
  [{ accountId: "b", amount: 600000 }, { accountId: "a", amount: 300000 }, { accountId: "c", amount: 100000 }],
  pfAccounts,
);
eq("portfolio order+names", pfShares.map((s) => s.name), ["키움증권", "국민은행", "업비트"]);
approx("portfolio pct top", pfShares[0].pct, 60);
approx("portfolio pct sum", pfShares.reduce((sum, s) => sum + s.pct, 0), 100);
eq("portfolio zero filtered", L.portfolioShares([{ accountId: "a", amount: 0 }], pfAccounts), []);
eq("portfolio empty", L.portfolioShares([], pfAccounts), []);
// 삭제된 계좌 잔고는 이름 폴백
eq("portfolio deleted account", L.portfolioShares([{ accountId: "zz", amount: 100 }], pfAccounts)[0].name, "(삭제된 계좌)");
// maxSlices 초과분은 '기타'로 합산
const manyShares = L.portfolioShares(
  [1, 2, 3, 4, 5, 6, 7].map((n) => ({ accountId: `x${n}`, amount: n * 100 })),
  [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `x${n}`, name: `계좌${n}` })),
  5,
);
eq("portfolio folds to 기타", [manyShares.length, manyShares.at(-1).name], [5, "기타"]);
approx("portfolio 기타 amount", manyShares.at(-1).amount, 100 + 200 + 300); // 하위 3개 합
approx("portfolio folded pct sum", manyShares.reduce((sum, s) => sum + s.pct, 0), 100);

// 유효 저축액: 예산 저축이 필요 월저축보다 클 때만 대체 (목표 보호)
eq("effSaving budget higher", L.effectiveMonthlySaving(1297931, 1500000), 1500000);
eq("effSaving budget lower ignored", L.effectiveMonthlySaving(1297931, 1000000), 1297931);
eq("effSaving no budget", L.effectiveMonthlySaving(1297931, undefined), 1297931);

// 봉투 현황: 카테고리 지출 합류, 초과 플래그
const envStatus = L.envelopeStatus(
  [{ category: "식비", amount: 400000 }, { category: "데이트", amount: 200000 }],
  { 식비: 450000 },
);
eq("envelope over", [envStatus[0].spent, envStatus[0].remaining, envStatus[0].over], [450000, -50000, true]);
eq("envelope unspent", [envStatus[1].spent, envStatus[1].over], [0, false]);

// 월급날 프롬프트: 월급일 이후 & 다음 달 예산 없음 & 미해제 → 다음 달 키
const jul25 = new Date(2026, 6, 25);
eq("prompt after payday", L.shouldPromptBudget(jul25, 25, {}, ""), "2026-08");
eq("prompt before payday", L.shouldPromptBudget(new Date(2026, 6, 24), 25, {}, ""), false);
eq("prompt already budgeted", L.shouldPromptBudget(jul25, 25, { "2026-08": { saving: 1 } }, ""), false);
eq("prompt dismissed", L.shouldPromptBudget(jul25, 25, {}, "2026-08"), false);
eq("prompt no payday", L.shouldPromptBudget(jul25, 0, {}, ""), false);
eq("prompt year rollover", L.shouldPromptBudget(new Date(2026, 11, 26), 25, {}, ""), "2027-01");
// 월급일 31이어도 짧은 달 말일에 프롬프트가 뜬다 (말일 클램프)
eq("prompt payday clamp 30d month", L.shouldPromptBudget(new Date(2026, 3, 30), 31, {}, ""), "2026-05");
eq("prompt payday clamp feb", L.shouldPromptBudget(new Date(2027, 1, 28), 30, {}, ""), "2027-03");

// 카테고리 이름 변경 시 봉투도 이관
const renamedBudgets = L.renameCategoryInBudgets(
  { "2026-08": { saving: 1, envelopes: [{ category: "데이트", amount: 200000 }, { category: "식비", amount: 1 }] } },
  "데이트", "연애",
);
eq("budget envelope renamed", renamedBudgets["2026-08"].envelopes.map((e) => e.category), ["연애", "식비"]);

// 동기화 방향: 최신 쪽이 이긴다 (LWW)
eq("sync both missing", L.syncDirection(undefined, undefined), "none");
eq("sync server empty", L.syncDirection("2026-07-20T10:00:00.000Z", null), "push");
eq("sync local empty", L.syncDirection(undefined, "2026-07-20T10:00:00.000Z"), "pull");
eq("sync server newer", L.syncDirection("2026-07-20T10:00:00.000Z", "2026-07-20T11:00:00.000Z"), "pull");
eq("sync local newer", L.syncDirection("2026-07-20T12:00:00.000Z", "2026-07-20T11:00:00.000Z"), "push");
eq("sync equal", L.syncDirection("2026-07-20T10:00:00.000Z", "2026-07-20T10:00:00.000Z"), "none");
eq("sync format mix equal", L.syncDirection("2026-07-20T10:00:00.000Z", "2026-07-20T10:00:00+00:00"), "none");
eq("sync garbage local", L.syncDirection("not-a-date", "2026-07-20T10:00:00.000Z"), "pull");

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log("\nall tests passed");
