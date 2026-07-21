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
// startDay 이전 날들은 하루 몫을 소진한 것으로 본다(늦게 시작해도 보너스 예산 금지).
// savingByDay: { [일]: 그날 기록한 저축 합 }. 저축은 기록한 날부터 예산을 줄인다 —
//   과거 판정일은 그대로 두어(소급 재판정 금지) 스트릭이 저축으로 무너지지 않게 한다.
function dailyBudgets(monthBudget, spendByDay, daysTotal, startDay = 1, savingByDay = {}) {
  const results = [];
  const share = Math.max(0, monthBudget) / daysTotal;
  let spentBefore = 0;
  let savedThrough = 0;
  for (let day = 1; day <= daysTotal; day += 1) {
    savedThrough += Number(savingByDay[day] || 0); // 오늘까지 기록한 저축은 오늘 예산부터 반영
    if (day < startDay) {
      const spent = Number(spendByDay[day] ?? 0);
      results.push({ day, budget: share, spent, judged: false, clear: false });
      spentBefore += Math.max(share, spent);
      continue;
    }
    const daysLeft = daysTotal - day + 1;
    const budget = Math.max(0, (monthBudget - spentBefore - savedThrough) / daysLeft);
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
// 저축은 계좌 간 이체라 순자산 불변 — 수입만 더하고 지출만 뺀다
// 전제: latestSettlement는 non-null (온보딩이 첫 결산을 보장)
function currentNetWorth(latestSettlement, transactions) {
  const net = transactions
    .filter((tx) => tx.date > latestSettlement.date && tx.type !== "saving")
    .reduce((sum, tx) => sum + (tx.type === "income" ? 1 : -1) * Number(tx.amount || 0), 0);
  return Number(latestSettlement.total) + net;
}

// 이번 달 저축 진행: 실제 저축한 금액 / 목표(미션이 떼어둔 저축액)
function savingProgress(saved, target) {
  const s = Number(saved || 0);
  const t = Number(target || 0);
  return {
    saved: s,
    target: t,
    remaining: Math.max(0, t - s),
    pct: t > 0 ? (s / t) * 100 : 0,
    done: t > 0 && s >= t,
  };
}

// 공백 정리 후 빈값·8자 초과·중복이면 null, 아니면 정규화된 이름
function validateNewCategory(rawName, existingNames) {
  const name = String(rawName || "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 8) return null;
  if (existingNames.includes(name)) return null;
  return name;
}

// 카테고리 이름 변경 시 과거 거래·고정 항목의 category를 함께 이관
// type("expense"|"income")을 주면 그 타입만 이관 — 지출/수입 양쪽에 같은 이름이 있어도 안전
function renameCategoryInRecords(transactions, fixedItems, from, to, type) {
  const swap = (item) =>
    item.category === from && (!type || item.type === type) ? { ...item, category: to } : item;
  return { transactions: transactions.map(swap), fixedItems: fixedItems.map(swap) };
}

// 이번 달 유효 저축액: 예산 시트의 저축이 필요 월저축보다 클 때만 대체(목표 페이스 보호)
function effectiveMonthlySaving(requiredSaving, budgetSaving) {
  const budget = Number(budgetSaving || 0);
  return budget > requiredSaving ? budget : requiredSaving;
}

// 봉투별 현황: 카테고리 지출을 합류해 사용액·잔여·초과 계산
function envelopeStatus(envelopes, spentByCategory) {
  return envelopes.map((envelope) => {
    const spent = Number(spentByCategory[envelope.category] || 0);
    const amount = Number(envelope.amount || 0);
    return { category: envelope.category, amount, spent, remaining: amount - spent, over: spent > amount };
  });
}

// 월급일 이후 & 다음 달 예산 미작성 & 그 달 프롬프트 미해제 → 다음 달 키, 아니면 false
// 월급일 29~31은 짧은 달의 말일로 클램프(고정 항목 자동 기록과 같은 규칙)
function shouldPromptBudget(today, paydayDay, budgets, dismissedMonth) {
  if (!(paydayDay >= 1)) return false;
  const payday = Math.min(paydayDay, daysInMonth(today.getFullYear(), today.getMonth() + 1));
  if (today.getDate() < payday) return false;
  const nextMonth = monthKey(addMonths(new Date(today.getFullYear(), today.getMonth(), 1), 1));
  if (budgets && budgets[nextMonth]) return false;
  if (dismissedMonth === nextMonth) return false;
  return nextMonth;
}

// 카테고리 이름 변경 시 모든 달의 봉투 카테고리를 함께 이관
function renameCategoryInBudgets(budgets, from, to) {
  const next = {};
  Object.entries(budgets || {}).forEach(([month, budget]) => {
    next[month] = {
      ...budget,
      envelopes: (budget.envelopes || []).map((e) => (e.category === from ? { ...e, category: to } : e)),
    };
  });
  return next;
}

// 계좌별 자산 비중: 잔고>0만, 금액 내림차순. maxSlices 초과 시 하위를 "기타"로 합산
function portfolioShares(balances, accounts, maxSlices = 5) {
  const rows = balances
    .map((b) => ({
      name: accounts.find((a) => a.id === b.accountId)?.name || "(삭제된 계좌)",
      amount: Number(b.amount || 0),
    }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  if (total <= 0) return [];
  const kept = rows.length > maxSlices ? rows.slice(0, maxSlices - 1) : rows;
  if (rows.length > maxSlices) {
    const rest = rows.slice(maxSlices - 1);
    kept.push({ name: "기타", amount: rest.reduce((sum, r) => sum + r.amount, 0) });
  }
  return kept.map((r) => ({ ...r, pct: (r.amount / total) * 100 }));
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
  settlementDeltas, savingSpeed, currentNetWorth, savingProgress, arrivalDate,
  validateNewCategory, renameCategoryInRecords, syncDirection, portfolioShares,
  effectiveMonthlySaving, envelopeStatus, shouldPromptBudget, renameCategoryInBudgets,
};
if (typeof module !== "undefined") module.exports = api;
