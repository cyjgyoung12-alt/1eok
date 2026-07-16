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
