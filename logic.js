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
  const lastDay = daysInMonth(next.getFullYear(), next.getMonth() + 1);
  next.setDate(Math.min(day, lastDay));
  return next;
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
// 전제: settlements는 월당 최대 1건 (호출측이 같은 달 재결산 시 교체)
function settlementDeltas(settlements) {
  const sorted = settlements.slice().sort((a, b) => a.month.localeCompare(b.month));
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
// 전제: latestSettlement는 non-null (온보딩이 첫 결산을 보장)
function currentNetWorth(latestSettlement, transactions) {
  const net = transactions
    .filter((tx) => tx.date > latestSettlement.date)
    .reduce((sum, tx) => sum + (tx.type === "income" ? 1 : -1) * Number(tx.amount || 0), 0);
  return Number(latestSettlement.total) + net;
}

// 공백 정리 후 빈값·8자 초과·중복이면 null, 아니면 정규화된 이름
function validateNewCategory(rawName, existingNames) {
  const name = String(rawName || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 8) return null;
  if (existingNames.includes(name)) return null;
  return name;
}

// 카테고리 이름 변경 시 과거 거래·고정 항목의 category를 함께 이관
function renameCategoryInRecords(transactions, fixedItems, from, to) {
  const swap = (item) => (item.category === from ? { ...item, category: to } : item);
  return { transactions: transactions.map(swap), fixedItems: fixedItems.map(swap) };
}

// 동기화 방향 판정(LWW): 파싱 불가한 시각은 없는 것으로 취급
function syncDirection(localUpdatedAt, serverUpdatedAt) {
  const local = Date.parse(localUpdatedAt || "");
  const server = Date.parse(serverUpdatedAt || "");
  const hasLocal = Number.isFinite(local);
  const hasServer = Number.isFinite(server);
  if (!hasLocal && !hasServer) return "none";
  if (!hasServer) return "push";
  if (!hasLocal) return "pull";
  if (server > local) return "pull";
  if (local > server) return "push";
  return "none";
}

function arrivalDate(remaining, monthlySaving, today) {
  if (!(monthlySaving > 0)) return null;
  return addMonths(today, Math.ceil(remaining / monthlySaving));
}

const api = {
  pad, localDateString, parseDate, monthKey, monthDiff, daysInMonth,
  monthsBetween, addMonths,
  requiredMonthlySaving, monthlyVariableBudget, dailyBudgets, missionStreak,
  settlementDeltas, savingSpeed, currentNetWorth, arrivalDate,
  validateNewCategory, renameCategoryInRecords, syncDirection,
};
if (typeof module !== "undefined") module.exports = api;
