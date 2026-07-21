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
    // 저축은 거래(transactions)가 아니라 별도 배열 — 순자산에 영향 없는 이체이고,
    // 구버전 클라이언트가 이 데이터를 동기화로 받아도 순자산 계산을 오염시키지 않는다
    savings: [],
    // categories가 전체 목록(기본 이름변경 가능), customCategories는 삭제 가능한 사용자 추가분 추적
    categories: { expense: [...expenseCategories], income: [...incomeCategories] },
    customCategories: { expense: [], income: [] },
    budgets: {},
    budgetPromptDismissed: "",
  };
}

// 구버전 상태(categories 없음)를 기본 + 사용자 추가분으로 이행.
// categories가 있어도 customCategories에만 있는 이름은 병합(append) —
// 구버전 앱이 customCategories만 갱신한 상태를 동기화로 받아도 추가분이 유실되지 않게 한다
function normalizeCategories(parsed) {
  const build = (type, defaults) => {
    const list = parsed.categories?.[type]?.length ? [...parsed.categories[type]] : [...defaults];
    (parsed.customCategories?.[type] || []).forEach((name) => {
      if (!list.includes(name)) list.push(name);
    });
    return list;
  };
  return { expense: build("expense", expenseCategories), income: build("income", incomeCategories) };
}

// 모든 달의 봉투 카테고리 이름(고아 포함) — 이름변경 충돌 검증용
function allBudgetEnvelopeNames() {
  return Object.values(state.budgets || {}).flatMap((budget) => (budget.envelopes || []).map((e) => e.category));
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
      savings: parsed.savings || [],
      categories: normalizeCategories(parsed),
      customCategories: {
        expense: parsed.customCategories?.expense || [],
        income: parsed.customCategories?.income || [],
      },
      budgets: parsed.budgets || {},
      budgetPromptDismissed: parsed.budgetPromptDismissed || "",
      toast: "",
    };
  } catch {
    return defaultState();
  }
}

// stamp:false는 부팅 시 재저장용 — updatedAt을 갱신하지 않아야
// 다른 기기의 더 새로운 서버 데이터를 pull로 받을 수 있다
function saveState(options) {
  const stamp = options?.stamp !== false;
  if (stamp) state = { ...state, updatedAt: new Date().toISOString() };
  const { toast, ...persisted } = state;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(persisted));
  } catch {
    // 저장 실패(시크릿 모드·쿼터 초과)여도 앱은 계속 동작해야 한다
  }
  if (stamp) syncSchedulePush(persisted);
}

function setState(next) {
  state = typeof next === "function" ? next(state) : next;
  saveState();
  render();
}

/* ---------- 파생 지표 (모든 계산은 logic.js 순수 함수 사용) ---------- */

function latestSettlement(settlements) {
  return settlements.slice().sort((a, b) => a.month.localeCompare(b.month)).at(-1) || null;
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
  // 저축 목표(봉투 goal): 필요 월저축, 또는 예산 시트에서 더 크게 잡은 값
  const budgetPlan = currentState.budgets?.[currentMonth] || null;
  const savingTarget = effectiveMonthlySaving(requiredSaving, budgetPlan?.saving);
  // 미션 예산은 월 수입 − 고정비. 저축은 미리 떼지 않고(선저축 강제 없음),
  // 기록한 날부터 그날 이후 예산만 줄인다(savingByDay) — 과거 판정일은 불변
  const monthBudget = monthlyVariableBudget(Number(s.monthlyIncome || 0), fixedExpenseSum, 0);
  const monthSavings = (currentState.savings || []).filter((sv) => monthKey(parseDate(sv.date)) === currentMonth);
  const monthSaving = monthSavings.reduce((sum, sv) => sum + Number(sv.amount || 0), 0);
  const savingByDay = {};
  monthSavings.forEach((sv) => {
    const day = parseDate(sv.date).getDate();
    savingByDay[day] = (savingByDay[day] || 0) + Number(sv.amount || 0);
  });

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
  // 시작 달에는 시작일 이전 몫을 소진 처리 (1일 시작 기준으로 빡세게)
  const startDate = s.startDate ? parseDate(s.startDate) : today;
  const startDay = monthKey(startDate) === currentMonth ? startDate.getDate() : 1;
  const dayResults = dailyBudgets(Math.max(0, monthBudget), spendByDay, daysTotal, startDay, savingByDay);
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

  const saving = savingProgress(monthSaving, savingTarget);

  const monthIncome = monthTx.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + Number(tx.amount), 0);
  const monthExpense = monthTx.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + Number(tx.amount), 0);
  const categoryExpenses = monthTx
    .filter((tx) => tx.type === "expense")
    .reduce((acc, tx) => {
      acc[tx.category] = (acc[tx.category] || 0) + Number(tx.amount || 0);
      return acc;
    }, {});
  // 봉투 소진용: 고정비 자동 기록 제외 — 봉투 등식(수입−고정비−저축−봉투)이 고정비를 이미 차감했으므로
  const variableCategoryExpenses = monthTx
    .filter((tx) => tx.type === "expense" && tx.source !== "fixed")
    .reduce((acc, tx) => {
      acc[tx.category] = (acc[tx.category] || 0) + Number(tx.amount || 0);
      return acc;
    }, {});

  return {
    today, currentMonth, netWorth, remaining, progress, requiredSaving,
    fixedExpenseSum, monthBudget, dayResults, todayResult, todayDay, streak,
    speed, arrival, basisLabel, settledThisMonth, settleDday, settleStreak,
    grid, monthIncome, monthExpense, categoryExpenses, variableCategoryExpenses,
    latest, budget: budgetPlan, savingTarget, monthSaving, saving,
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
  const sorted = settlements.slice().sort((a, b) => a.month.localeCompare(b.month));
  const deltas = settlementDeltas(sorted);
  const deltasByMonth = {};
  sorted.slice(1).forEach((st, index) => {
    deltasByMonth[st.month] = deltas[index];
  });
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
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;
  bindEvents(metrics);
  if (!state.hasOnboarded && !document.querySelector(".wizard-backdrop")) openOnboardingWizard();
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
        <p class="mission-warn">월 수입이 고정비보다 적습니다. 설정에서 월 수입·고정비를 확인해 주세요.</p>
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

// 저축 진행 한 줄. compact면 금액 소계 줄을 생략(첫 화면용)
function savingRowHtml(m, compact) {
  const sp = m.saving;
  if (!(sp.target > 0)) return "";
  const pct = Math.min(100, Math.round(sp.pct));
  const right = sp.done ? "완료 ✓" : `${pct}% · ${money(sp.remaining)} 남음`;
  return `
    <div class="budget-row${compact ? " compact" : ""} saving-row">
      <div class="budget-row-top"><span>저축</span><span class="num">${right}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      ${compact ? "" : `<div class="budget-row-sub num">${money(sp.saved)} / ${money(Math.round(sp.target))}</div>`}
    </div>`;
}

// 첫 화면 봉투 현황: 저축 목표나 봉투가 있으면 표시. 편집은 흐름 탭(카드 탭하면 이동)
function realityBudgetCardHtml(m) {
  const savingRow = savingRowHtml(m, true);
  const status = m.budget ? envelopeStatus(m.budget.envelopes || [], m.variableCategoryExpenses) : [];
  const rows = status
    .map((s) => {
      const pct = s.amount > 0 ? Math.round((s.spent / s.amount) * 100) : 0;
      return `
      <div class="budget-row compact">
        <div class="budget-row-top"><span>${escapeHtml(s.category)}</span><span class="num">${s.over ? `초과 +${money(s.spent - s.amount)}` : `${pct}% · ${money(s.remaining)} 남음`}</span></div>
        <div class="progress-track"><div class="progress-fill plain" style="width:${Math.min(100, pct)}%"></div></div>
      </div>`;
    })
    .join("");
  if (!savingRow && !rows) return "";
  return `
    <button type="button" class="section card budget-card" data-goto-flow>
      <div class="section-title-row"><h2 class="section-title">이번 달 예산</h2><span class="section-note">편집은 흐름 탭 ›</span></div>
      ${savingRow}${rows}
    </button>
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
      ${m.requiredSaving > 0 ? `<p class="hero-sub num">필요 월저축 ${money(Math.round(m.requiredSaving))}${Number(state.settings.monthlyIncome || 0) > 0 ? ` · 수입의 ${((m.requiredSaving / Number(state.settings.monthlyIncome)) * 100).toFixed(1)}%` : ""}</p>` : ""}
      <div class="progress-track"><div class="progress-fill plain" style="width:${m.progress}%"></div></div>
      <button class="basis-button" data-open-speed>${m.basisLabel}</button>
    </section>
    ${realityBudgetCardHtml(m)}
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
          ? `<p class="settle-sub">이번 달 결산 완료 · 보고서는 흐름 탭에</p>
             <button class="ghost-button" data-open-settle>다시 결산</button>`
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

function categoriesFor(type) {
  const stored = state.categories?.[type];
  if (stored?.length) return stored;
  const base = type === "income" ? incomeCategories : expenseCategories;
  return [...base, ...(state.customCategories?.[type] || [])];
}

function addCategoryToState(type, name) {
  state = {
    ...state,
    categories: { ...state.categories, [type]: [...categoriesFor(type), name] },
    customCategories: { ...state.customCategories, [type]: [...(state.customCategories?.[type] || []), name] },
  };
  saveState();
}

// 이름 변경을 모든 곳에 이관: 거래·고정 항목(타입 한정)·봉투(지출만)·카테고리 목록
function renameCategoryEverywhere(type, from, to) {
  const migrated = renameCategoryInRecords(state.transactions, state.fixedItems, from, to, type);
  state = {
    ...state,
    transactions: migrated.transactions,
    fixedItems: migrated.fixedItems,
    budgets: type === "expense" ? renameCategoryInBudgets(state.budgets, from, to) : state.budgets,
    categories: { ...state.categories, [type]: categoriesFor(type).map((c) => (c === from ? to : c)) },
    customCategories: {
      ...state.customCategories,
      [type]: (state.customCategories?.[type] || []).map((c) => (c === from ? to : c)),
    },
  };
  saveState();
}

function openTransactionSheet(type) {
  // type: "expense" | "income". 저축은 지출 시트의 특수 카테고리(◐ 저축)로 기록한다
  const isExpense = type === "expense";
  let selectedCategory = categoriesFor(type)[0];
  let savingSelected = false;
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
          <div class="chips" data-category-chips></div>
        </div>
        <p class="saving-hint" data-saving-hint hidden>◐ 저축은 쓴 게 아니라 저축·투자 계좌로 남긴 돈입니다. 자산은 그대로이고, 이번 달 쓸 돈이 그만큼 줄어듭니다.</p>
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

  const chipsBox = modal.querySelector("[data-category-chips]");
  const hintEl = modal.querySelector("[data-saving-hint]");
  const renderChips = () => {
    const categories = categoriesFor(type);
    const savingChip = isExpense
      ? `<button class="chip chip-saving ${savingSelected ? "active" : ""}" type="button" data-pick-saving>◐ 저축</button>`
      : "";
    chipsBox.innerHTML = categories
      .map((name, i) => `<button class="chip ${!savingSelected && name === selectedCategory ? "active" : ""}" type="button" data-pick-category="${i}">${escapeHtml(name)}</button>`)
      .join("") + savingChip + `<button class="chip chip-add" type="button" data-add-category>+ 추가</button>`;
    if (hintEl) hintEl.hidden = !savingSelected;
    chipsBox.querySelectorAll("[data-pick-category]").forEach((button) => {
      button.addEventListener("click", () => {
        savingSelected = false;
        selectedCategory = categoriesFor(type)[Number(button.dataset.pickCategory)];
        renderChips();
      });
    });
    chipsBox.querySelector("[data-pick-saving]")?.addEventListener("click", () => {
      savingSelected = true;
      renderChips();
    });
    chipsBox.querySelector("[data-add-category]").addEventListener("click", () => {
      const input = window.prompt("새 카테고리 이름 (8자 이내)");
      if (input === null) return;
      const name = validateNewCategory(input, categoriesFor(type));
      if (!name) {
        window.alert("빈 이름, 8자 초과, 이미 있는 이름은 쓸 수 없습니다.");
        return;
      }
      addCategoryToState(type, name);
      savingSelected = false;
      selectedCategory = name;
      renderChips();
    });
  };
  renderChips();

  modal.querySelector("[data-transaction-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = numberFromInput(form.get("amount"));
    if (!amount) return;
    const base = {
      id: cryptoId(),
      amount,
      date: String(form.get("date") || localDateString(new Date())),
      source: "manual",
    };
    let next;
    if (savingSelected) {
      // 저축은 별도 savings 배열(이체 — 순자산·거래 집계와 분리, 이번 달 쓸 돈만 줄인다)
      const record = { ...base, type: "saving", category: "저축", title: String(form.get("title") || "저축") };
      next = { ...state, savings: [...(state.savings || []), record] };
    } else {
      const record = { ...base, type, category: selectedCategory, title: String(form.get("title") || selectedCategory) };
      next = { ...state, transactions: [...state.transactions, record] };
    }
    const after = getMetrics(next);
    const remaining = after.monthBudget > 0 ? after.todayResult.budget - after.todayResult.spent : null;
    let toast;
    if (savingSelected) {
      toast = remaining !== null && remaining >= 0
        ? `저축 ${money(amount)} 기록 · 오늘 잔여 ${money(Math.round(remaining))}`
        : `저축 ${money(amount)} 기록 · 이번 달 ${money(after.saving.saved)}${after.saving.target > 0 ? ` / ${money(Math.round(after.saving.target))}` : ""}`;
    } else if (type === "income") {
      toast = `수입 +${money(amount)} 기록했습니다.`;
    } else if (after.monthBudget <= 0) {
      toast = `지출 ${money(amount)} 저장했습니다.`;
    } else {
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

let toastTimer = 0;

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

// 모든 숫자 입력칸(inputmode="numeric")에 실시간 세 자리 콤마 — numberFromInput이 콤마를 걷어내므로 저장 로직과 무관
document.addEventListener("input", (event) => {
  const el = event.target;
  if (!(el instanceof HTMLInputElement) || el.getAttribute("inputmode") !== "numeric") return;
  const raw = el.value.replace(/[^\d]/g, "");
  const formatted = raw ? Number(raw).toLocaleString("ko-KR") : "";
  if (el.value !== formatted) el.value = formatted;
});

function clearToastSoon() {
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
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
             ${deltas.map((d) => `<div class="money-row"><span>월 저축</span><strong class="num">${signedMoney(Math.round(d))}</strong></div>`).join("")}</div>`
          : `<p class="empty-state">결산이 2번 쌓이면 실제 속도로 전환됩니다.</p>`
      }
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);
}

/* ---------- 결산 시트 ---------- */

function openSettleSheet(m, focusAccountId) {
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
                <input inputmode="numeric" name="acc-${account.id}" value="${prevBalance(account.id) === "" ? "" : Number(prevBalance(account.id)).toLocaleString("ko-KR")}" placeholder="잔고" />
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
  if (focusAccountId) modal.querySelector(`[name="acc-${focusAccountId}"]`)?.focus();

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
    if (total <= 0) {
      state.toast = "잔고를 입력해 주세요.";
      render();
      clearToastSoon();
      return;
    }
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

function settlementArrival(sortedSettlements, index, targetAmount) {
  const st = sortedSettlements[index];
  const history = sortedSettlements.slice(0, index + 1);
  const speed = savingSpeed(history, Number(st.requiredSaving || 0));
  const remaining = Math.max(0, targetAmount - st.total);
  return arrivalDate(remaining, speed.monthlySaving, parseDate(st.date));
}

function openReportSheet(settlement) {
  const sorted = state.settlements.slice().sort((a, b) => a.month.localeCompare(b.month));
  const index = sorted.findIndex((st) => st.month === settlement.month);
  const prev = index > 0 ? sorted[index - 1] : null;
  const gap = prev ? Math.max(1, monthDiff(prev.month, settlement.month)) : 0;
  const delta = prev ? (settlement.total - prev.total) / gap : null;
  const required = Number(settlement.requiredSaving || 0);
  const income = Number(settlement.monthlyIncome || 0);
  const targetAmount = Number(state.settings.targetAmount || 0);
  const arrivalNow = index >= 0 ? settlementArrival(sorted, index, targetAmount) : null;
  const arrivalPrevDate = index > 0 ? settlementArrival(sorted, index - 1, targetAmount) : null;
  const arrivalText = arrivalNow ? `${arrivalNow.getFullYear()}년 ${arrivalNow.getMonth() + 1}월` : "속도 부족";
  let arrivalShift = "";
  if (arrivalNow && arrivalPrevDate) {
    const shift = monthDiff(monthKey(arrivalPrevDate), monthKey(arrivalNow));
    arrivalShift = shift === 0 ? " · 변화 없음" : shift > 0 ? ` · ${shift}개월 밀림` : ` · ${Math.abs(shift)}개월 앞당김`;
  }
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
              <div class="report-line"><span>도착 예상</span><strong class="num">${arrivalText}${arrivalShift}</strong></div>
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
  document.querySelector("[data-goto-flow]")?.addEventListener("click", () => setState((prev) => ({ ...prev, activeTab: "flow" })));
  bindRecordEvents();
  bindFlowEvents();
  bindSettingsEvents();
}

/* ---------- 기록 탭 ---------- */

function renderRecord(m) {
  const entries = [...state.transactions, ...(state.savings || [])];
  const recent = entries.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
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
      <div class="section-title-row"><h2 class="section-title">최근 기록</h2><span class="section-note">${entries.length}건</span></div>
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
                      <div class="item-amount num ${tx.type}">${tx.type === "income" ? "+" : tx.type === "saving" ? "◐ " : "-"}${money(tx.amount)}</div>
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
      const id = button.dataset.deleteTransaction;
      setState((prev) => ({
        ...prev,
        transactions: prev.transactions.filter((tx) => tx.id !== id),
        savings: (prev.savings || []).filter((sv) => sv.id !== id),
        toast: "기록을 삭제했습니다.",
      }));
      clearToastSoon();
    });
  });
}

/* ---------- 흐름 탭 (보고서 보관함) ---------- */

// dataviz 검증 통과 팔레트: 인접 명도 교차(민트·회색), 배경 #12151a 대비 3:1 이상
const PORTFOLIO_COLORS = ["#3ce8a4", "#5d6879", "#b7e9d4", "#17936a", "#dfe4ea"];

// 도넛 중앙용 축약 표기: 구멍 폭(약 70px)을 넘지 않게 만원/억 단위로 줄인다
function compactMoney(value) {
  const n = Math.round(Number(value || 0));
  if (n >= 100000000) return `${(n / 100000000).toFixed(n % 100000000 === 0 ? 0 : 1)}억`;
  if (n >= 10000) return `${Math.round(n / 10000).toLocaleString("ko-KR")}만원`;
  return `${n.toLocaleString("ko-KR")}원`;
}

function portfolioCardHtml(m) {
  const latest = m.latest;
  if (!latest) return "";
  const shares = portfolioShares(latest.balances || [], state.accounts, PORTFOLIO_COLORS.length);
  if (!shares.length) return "";
  // 중앙 합계는 도넛이 실제로 그리는 양수 잔고 합(음수 잔고가 섞인 과거 데이터와의 모순 방지)
  const total = shares.reduce((sum, share) => sum + share.amount, 0);
  const R = 40;
  const C = 2 * Math.PI * R;
  const gap = shares.length > 1 ? 2.5 : 0;
  let offset = 0;
  const segments = shares
    .map((share, i) => {
      const len = (share.pct / 100) * C;
      // drawn ≤ len 보장: 극소 조각이 원을 한 바퀴 돌아 다른 조각을 덮지 않게 한다(목록에는 항상 표시됨)
      const drawn = Math.max(0, len - gap);
      const seg = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${PORTFOLIO_COLORS[i]}" stroke-width="14" stroke-dasharray="${drawn} ${C - drawn}" stroke-dashoffset="${-offset}" />`;
      offset += len;
      return seg;
    })
    .join("");
  const rows = shares
    .map(
      (share, i) => `
        <div class="portfolio-row">
          <span class="portfolio-dot" style="background:${PORTFOLIO_COLORS[i]}"></span>
          <span class="portfolio-name">${escapeHtml(share.name)}</span>
          <strong class="num">${money(share.amount)}</strong>
          <span class="portfolio-pct num">${share.pct.toFixed(1)}%</span>
        </div>`,
    )
    .join("");
  return `
    <section class="card">
      <div class="section-title-row"><h2 class="section-title">자산 구성</h2><span class="section-note">${Number(latest.month.split("-")[1])}월 결산 기준</span></div>
      <div class="portfolio-wrap">
        <div class="portfolio-donut">
          <svg viewBox="0 0 120 120" role="img" aria-label="계좌별 자산 비중">
            <g transform="rotate(-90 60 60)">${segments}</g>
          </svg>
          <div class="portfolio-center"><strong class="num">${compactMoney(total)}</strong><span>총자산</span></div>
        </div>
        <div class="portfolio-list">${rows}</div>
      </div>
    </section>
  `;
}

function budgetCardHtml(m) {
  const budget = m.budget;
  // 월급일이 지났고 다음 달 예산이 없으면 수동 진입 버튼 제공(자동 시트를 실수로 닫아도 경로 유지)
  const payday = state.fixedItems.find((item) => item.active && item.type === "income")?.day || 0;
  const clampedPayday = payday ? Math.min(payday, daysInMonth(m.today.getFullYear(), m.today.getMonth() + 1)) : 0;
  const nextMonth = monthKey(addMonths(new Date(m.today.getFullYear(), m.today.getMonth(), 1), 1));
  const nextButton =
    clampedPayday >= 1 && m.today.getDate() >= clampedPayday && !state.budgets?.[nextMonth]
      ? `<button class="secondary-button" data-open-budget="${nextMonth}">${Number(nextMonth.split("-")[1])}월 예산 짜기</button>`
      : "";
  const savingRow = savingRowHtml(m, false);
  if (!budget) {
    return `
    <section class="card">
      <div class="section-title-row"><h2 class="section-title">이번 달 예산</h2><span class="section-note">${savingRow ? "저축만 설정됨" : "미설정"}</span></div>
      ${savingRow}
      <button class="secondary-button" data-open-budget="${m.currentMonth}">예산 정하기</button>
      ${nextButton}
    </section>`;
  }
  const status = envelopeStatus(budget.envelopes || [], m.variableCategoryExpenses);
  const rows = status
    .map((s) => {
      const pct = s.amount > 0 ? Math.min(100, (s.spent / s.amount) * 100) : 0;
      return `
      <div class="budget-row">
        <div class="budget-row-top"><span>${escapeHtml(s.category)}</span><span class="num">${s.over ? `초과 +${money(s.spent - s.amount)}` : `${money(s.remaining)} 남음`}</span></div>
        <div class="progress-track"><div class="progress-fill plain" style="width:${pct}%"></div></div>
        <div class="budget-row-sub num">${money(s.spent)} / ${money(s.amount)}</div>
      </div>`;
    })
    .join("");
  return `
    <section class="card">
      <div class="section-title-row"><h2 class="section-title">이번 달 예산</h2><span class="section-note num">저축 목표 ${money(Math.round(m.savingTarget))}</span></div>
      ${savingRow}
      ${rows || `<p class="empty-state">봉투가 없습니다. 예산 편집에서 추가하세요.</p>`}
      <button class="secondary-button" data-open-budget="${m.currentMonth}">예산 편집</button>
      ${nextButton}
    </section>`;
}

function renderFlow(m) {
  const sorted = state.settlements.slice().sort((a, b) => b.month.localeCompare(a.month));
  const deltas = settlementDeltas(state.settlements);
  const recentDeltas = deltas.slice(-6);
  const maxDelta = Math.max(...recentDeltas.map((d) => Math.abs(d)), 1);
  const categories = Object.entries(m.categoryExpenses).sort((a, b) => b[1] - a[1]);
  const maxCategory = Math.max(...categories.map(([, v]) => v), 1);
  return `
    ${renderHeader()}
    ${portfolioCardHtml(m)}
    ${budgetCardHtml(m)}
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
                    <div class="bar-label num">${d >= 0 ? "+" : "−"}</div>
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
  document.querySelectorAll("[data-open-budget]").forEach((button) => {
    button.addEventListener("click", () => openBudgetSheet(button.dataset.openBudget));
  });
}

/* ---------- 설정 탭 ---------- */

function settingsAccountRowHtml(account, latest) {
  const found = latest?.balances?.find((b) => b.accountId === account.id);
  const balanceText = found ? money(Number(found.amount)) : "";
  return `
    <button type="button" class="settings-row" data-open-account="${account.id}">
      <span class="settings-row-main">
        <span class="${account.active ? "" : "off"}">${escapeHtml(account.name)}</span>
        ${account.active ? "" : `<span class="sub">꺼짐</span>`}
      </span>
      <span class="settings-row-side">
        ${balanceText ? `<span class="val num">${balanceText}</span>` : ""}<span class="chev">›</span>
      </span>
    </button>
  `;
}

function settingsFixedRowHtml(item) {
  return `
    <button type="button" class="settings-row" data-open-fixed-item="${item.id}">
      <span class="settings-row-main">
        <span class="${item.active ? "" : "off"}">${escapeHtml(item.name)}</span>
        <span class="sub">매월 ${item.day}일${item.active ? "" : " · 꺼짐"}</span>
      </span>
      <span class="settings-row-side">
        <span class="val num ${item.type === "income" ? "income" : ""}">${item.type === "income" ? "+" : "-"}${money(item.amount)}</span>
        <span class="chev">›</span>
      </span>
    </button>
  `;
}

function syncSectionHtml() {
  if (!syncConfigured()) return `<p class="empty-state">서버 설정 대기 중입니다.</p>`;
  if (!syncEnabled()) {
    return `
      <div class="button-row">
        <button class="secondary-button" data-sync-start>동기화 시작</button>
        <button class="secondary-button" data-sync-link>기존 키로 연결</button>
      </div>
    `;
  }
  const last = syncGetSettings()?.lastSyncedAt;
  return `
    <p class="empty-state">마지막 동기화 ${last ? new Date(last).toLocaleString("ko-KR") : "기록 없음"}</p>
    <div class="button-row">
      <button class="secondary-button" data-sync-now>지금 동기화</button>
      <button class="secondary-button" data-sync-key>키 보기</button>
    </div>
    <div class="section"><button class="danger-button" data-sync-off>동기화 끄기</button></div>
  `;
}

function renderSettings(m) {
  const accounts = state.accounts.slice().sort((a, b) => a.order - b.order);
  return `
    ${renderHeader()}
    <div class="form-grid">
      <section class="card">
        <div class="section-title-row"><h2 class="section-title">목표</h2><span class="section-note num">현재 ${m.progress.toFixed(1)}%</span></div>
        <form class="form-grid" data-settings-form>
          <div class="field"><label for="targetAmount">목표 금액</label><input id="targetAmount" name="targetAmount" inputmode="numeric" value="${Number(state.settings.targetAmount || 0).toLocaleString("ko-KR")}" /></div>
          <div class="two-col">
            <div class="field"><label for="targetDate">목표일</label><input id="targetDate" name="targetDate" type="date" value="${escapeHtml(state.settings.targetDate)}" /></div>
            <div class="field"><label for="monthlyIncome">월 수입</label><input id="monthlyIncome" name="monthlyIncome" inputmode="numeric" value="${Number(state.settings.monthlyIncome || 0).toLocaleString("ko-KR")}" /></div>
          </div>
          <button class="primary-button" type="submit">목표 저장</button>
        </form>
      </section>
      <section class="card">
        <div class="section-title-row"><h2 class="section-title">계좌</h2><span class="section-note">${accounts.filter((a) => a.active).length}개 활성</span></div>
        <div class="settings-list">${accounts.map((account) => settingsAccountRowHtml(account, m.latest)).join("")}</div>
        <button class="secondary-button" data-add-account>계좌 추가</button>
      </section>
      <section class="card">
        <div class="section-title-row"><h2 class="section-title">고정 항목</h2><span class="section-note">매달 자동 기록</span></div>
        <div class="settings-list">${state.fixedItems.map((item) => settingsFixedRowHtml(item)).join("")}</div>
        <button class="secondary-button" data-open-fixed>고정 항목 추가</button>
      </section>
      <section class="card">
        <div class="section-title-row"><h2 class="section-title">카테고리</h2><span class="section-note">칩을 탭하면 관리</span></div>
        ${["expense", "income"]
          .map(
            (type) => `
          <p class="cat-group-label">${type === "expense" ? "지출" : "수입"}</p>
          <div class="chips">
            ${categoriesFor(type)
              .filter((name) => !(type === "expense" && name === "고정비"))
              .map((name) => `<button type="button" class="chip" data-cat-type="${type}" data-cat-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
              .join("")}
            <button type="button" class="chip chip-add" data-cat-add="${type}">+ 추가</button>
          </div>`,
          )
          .join("")}
      </section>
      <section class="card">
        <div class="section-title-row"><h2 class="section-title">동기화</h2><span class="section-note">${syncEnabled() ? "켜짐" : "꺼짐"}</span></div>
        ${syncSectionHtml()}
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
    const id = cryptoId();
    setState((prev) => ({
      ...prev,
      accounts: [...prev.accounts, { id, name: name.trim(), order: prev.accounts.length, active: true }],
      toast: "계좌를 추가했습니다. 잔고를 저장하면 자산에 바로 반영됩니다.",
    }));
    clearToastSoon();
    // 새 계좌 잔고를 그 자리에서 입력받는다: 이번 달 결산 갱신(같은 달은 교체)
    openSettleSheet(getMetrics(state), id);
  });
  document.querySelectorAll("[data-open-account]").forEach((button) => {
    button.addEventListener("click", () => {
      const account = state.accounts.find((a) => a.id === button.dataset.openAccount);
      if (account) openAccountManageSheet(account);
    });
  });

  document.querySelector("[data-open-fixed]")?.addEventListener("click", openFixedSheet);
  document.querySelectorAll("[data-open-fixed-item]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.fixedItems.find((it) => it.id === button.dataset.openFixedItem);
      if (item) openFixedManageSheet(item);
    });
  });

  document.querySelectorAll("[data-cat-type]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.catType;
      const name = button.dataset.catName;
      if (name && categoriesFor(type).includes(name)) openCategoryManageSheet(type, name);
    });
  });
  document.querySelectorAll("[data-cat-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.catAdd;
      const input = window.prompt("새 카테고리 이름 (8자 이내)");
      if (input === null) return;
      const name = validateNewCategory(input, categoriesFor(type));
      if (!name) {
        window.alert("빈 이름, 8자 초과, 이미 있는 이름은 쓸 수 없습니다.");
        return;
      }
      addCategoryToState(type, name);
      state = { ...state, toast: "카테고리를 추가했습니다." };
      render();
      clearToastSoon();
    });
  });

  document.querySelector("[data-sync-start]")?.addEventListener("click", async () => {
    const key = syncNewKey();
    syncSetKey(key);
    const { toast, ...persisted } = state;
    try {
      await syncPushNow(persisted);
    } catch {
      syncClear();
      window.alert("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
      return;
    }
    window.prompt("동기화 키입니다. 복사해서 안전한 곳에 보관하세요.", key);
    setState((prev) => ({ ...prev, toast: "동기화를 시작했습니다." }));
    clearToastSoon();
  });
  document.querySelector("[data-sync-link]")?.addEventListener("click", async () => {
    const input = window.prompt("다른 기기의 동기화 키를 붙여넣어 주세요.");
    if (!input?.trim()) return;
    const key = input.trim();
    let payload;
    try {
      payload = await syncPullNow(key);
    } catch {
      window.alert("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
      return;
    }
    if (!payload) {
      window.alert("해당 키로 저장된 데이터가 없습니다.");
      return;
    }
    if (state.hasOnboarded && !window.confirm("이 기기의 데이터를 서버 데이터로 교체할까요?")) return;
    syncSetKey(key);
    syncMarkSynced();
    applyServerState(payload, "서버 데이터를 가져왔습니다.");
  });
  document.querySelector("[data-sync-now]")?.addEventListener("click", async () => {
    try {
      const message = await manualSync();
      if (message) {
        setState((prev) => ({ ...prev, toast: message }));
        clearToastSoon();
      }
    } catch {
      window.alert("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
    }
  });
  document.querySelector("[data-sync-key]")?.addEventListener("click", () => {
    const key = syncGetSettings()?.key;
    if (key) window.prompt("동기화 키 (복사용)", key);
  });
  document.querySelector("[data-sync-off]")?.addEventListener("click", () => {
    if (!window.confirm("동기화를 끌까요? 서버 데이터는 남고, 이 기기는 로컬에만 저장합니다.")) return;
    syncClear();
    setState((prev) => ({ ...prev, toast: "동기화를 껐습니다." }));
    clearToastSoon();
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

/* ---------- 고정 항목 추가 시트 ---------- */

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

/* ---------- 계좌/고정 항목 관리 시트 (행 탭 → 액션 스택) ---------- */

function openAccountManageSheet(account) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">${escapeHtml(account.name)}</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <div class="form-grid">
        <button class="secondary-button" data-manage-rename>이름 변경</button>
        <button class="secondary-button" data-manage-toggle>${account.active ? "끄기" : "켜기"}</button>
        <button class="danger-button" data-manage-delete>삭제</button>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);

  modal.querySelector("[data-manage-rename]").addEventListener("click", () => {
    const name = window.prompt("새 이름", account.name || "");
    if (!name?.trim()) return;
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) => (a.id === account.id ? { ...a, name: name.trim() } : a)),
    }));
    modal.remove();
  });
  modal.querySelector("[data-manage-toggle]").addEventListener("click", () => {
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((a) => (a.id === account.id ? { ...a, active: !a.active } : a)),
    }));
    modal.remove();
  });
  modal.querySelector("[data-manage-delete]").addEventListener("click", () => {
    if (!window.confirm("계좌를 삭제할까요? 과거 결산 기록은 유지됩니다.")) return;
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.filter((a) => a.id !== account.id),
    }));
    modal.remove();
  });
}

function openFixedManageSheet(item) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">${escapeHtml(item.name)}</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <div class="form-grid">
        <button class="secondary-button" data-manage-toggle>${item.active ? "끄기" : "켜기"}</button>
        <button class="danger-button" data-manage-delete>삭제</button>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);

  modal.querySelector("[data-manage-toggle]").addEventListener("click", () => {
    const next = {
      ...state,
      fixedItems: state.fixedItems.map((it) => (it.id === item.id ? { ...it, active: !it.active } : it)),
    };
    state = applyFixedItems(next);
    saveState();
    modal.remove();
    render();
  });
  modal.querySelector("[data-manage-delete]").addEventListener("click", () => {
    setState((prev) => ({
      ...prev,
      fixedItems: prev.fixedItems.filter((it) => it.id !== item.id),
    }));
    modal.remove();
  });
}

function openCategoryManageSheet(type, name) {
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">${escapeHtml(name)}</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <div class="form-grid">
        <button class="secondary-button" data-manage-rename>이름 변경</button>
        <button class="danger-button" data-manage-delete>삭제</button>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);

  modal.querySelector("[data-manage-rename]").addEventListener("click", () => {
    const input = window.prompt("새 이름 (8자 이내)", name);
    if (input === null) return;
    // 지출은 고아 봉투 이름과의 충돌도 막는다(같은 이름 봉투 이중 생성 방지)
    const reserved = type === "expense" ? [...categoriesFor(type), ...allBudgetEnvelopeNames()] : categoriesFor(type);
    const next = validateNewCategory(input, reserved.filter((c) => c !== name));
    if (!next) {
      window.alert("빈 이름, 8자 초과, 이미 있는 이름은 쓸 수 없습니다.");
      return;
    }
    if (next === name) { modal.remove(); return; }
    renameCategoryEverywhere(type, name, next);
    state = { ...state, toast: "과거 기록까지 이름을 바꿨습니다." };
    render();
    modal.remove();
    clearToastSoon();
  });
  modal.querySelector("[data-manage-delete]")?.addEventListener("click", () => {
    // 타입별 마지막 카테고리는 남겨야 기록 입력이 가능하다
    if (categoriesFor(type).filter((c) => !(type === "expense" && c === "고정비")).length <= 1) {
      window.alert("마지막 카테고리는 삭제할 수 없습니다.");
      return;
    }
    if (!window.confirm("카테고리를 삭제할까요? 과거 기록은 그대로 남고, 같은 이름으로 다시 추가하면 복구됩니다.")) return;
    setState((prev) => ({
      ...prev,
      categories: { ...prev.categories, [type]: categoriesFor(type).filter((c) => c !== name) },
      customCategories: {
        ...prev.customCategories,
        [type]: (prev.customCategories?.[type] || []).filter((c) => c !== name),
      },
      toast: "카테고리를 삭제했습니다.",
    }));
    modal.remove();
    clearToastSoon();
  });
}

/* ---------- 동기화 ---------- */

// 서버 상태로 교체. updatedAt은 서버 값을 유지해 저장-업로드 핑퐁을 막고,
// 예약된 업로드를 취소해 옛 스냅샷이 서버를 덮어쓰지 않게 한다
function applyServerState(payload, toastText) {
  syncCancelPending();
  state = applyFixedItems({
    ...defaultState(),
    ...payload,
    settings: { ...defaultState().settings, ...payload.settings },
    savings: payload.savings || [],
    categories: normalizeCategories(payload),
    customCategories: {
      expense: payload.customCategories?.expense || [],
      income: payload.customCategories?.income || [],
    },
    toast: toastText || "다른 기기의 변경사항을 받았습니다.",
  });
  const { toast, ...persisted } = state;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(persisted));
  } catch {
    // 무시
  }
  render();
  clearToastSoon();
}

// 수동 동기화(버튼·당겨서 새로고침 공용). pull 적용 시 토스트까지 내부 처리하고 null 반환
async function manualSync() {
  const server = await syncPullNow();
  const direction = syncDirection(state.updatedAt, server?.updatedAt);
  if (direction === "pull") {
    applyServerState(server);
    return null;
  }
  if (direction === "push") {
    const { toast, ...persisted } = state;
    await syncPushNow(persisted);
  }
  return "동기화 완료 · 최신 상태";
}

async function runStartupSync() {
  if (!syncEnabled()) return;
  try {
    const server = await syncPullNow();
    const direction = syncDirection(state.updatedAt, server?.updatedAt);
    if (direction === "pull") {
      applyServerState(server);
    } else if (direction === "push") {
      const { toast, ...persisted } = state;
      await syncPushNow(persisted);
    }
  } catch {
    // 오프라인이면 다음 저장·다음 실행에서 재시도
  }
}

/* ---------- 예산(봉투) 시트 ---------- */

function openBudgetSheet(targetMonth) {
  const m = getMetrics(state);
  const monthNum = Number(targetMonth.split("-")[1]);
  const existing = state.budgets?.[targetMonth] || null;
  const income = Number(state.settings.monthlyIncome || 0);
  const fixedSum = m.fixedExpenseSum;
  const requiredFloor = Math.round(m.requiredSaving);
  const savingInit = existing?.saving ?? requiredFloor;

  // 봉투 목록 = 지출 카테고리(고정비 제외) + 삭제된 카테고리의 기존 봉투(저장 시 소멸 방지)
  const categoryList = () => {
    const base = categoriesFor("expense").filter((c) => c !== "고정비");
    const orphaned = (state.budgets?.[targetMonth]?.envelopes || []).map((e) => e.category).filter((c) => !base.includes(c));
    return [...base, ...orphaned];
  };
  const initialValues = {};
  (existing?.envelopes || []).forEach((e) => {
    initialValues[e.category] = Number(e.amount).toLocaleString("ko-KR");
  });

  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">${monthNum}월 예산</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <form class="form-grid" data-budget-form>
        <div class="money-row"><span>월 수입</span><strong class="num">${money(income)}</strong></div>
        <div class="money-row"><span>고정비</span><strong class="num">-${money(fixedSum)}</strong></div>
        <div class="field"><label for="budgetSaving">저축액 · 최소 ${money(requiredFloor)}</label>
          <input id="budgetSaving" name="saving" inputmode="numeric" value="${Number(savingInit).toLocaleString("ko-KR")}" /></div>
        <div class="form-grid" data-budget-cats></div>
        <button type="button" class="secondary-button" data-add-budget-category>+ 카테고리 추가</button>
        <div class="settle-total"><span>미배분</span><strong class="num" data-budget-left>0원</strong></div>
        <p class="budget-warn" data-budget-warn>배분이 수입을 넘습니다. 저장은 되지만 미션 예산과 어긋납니다.</p>
        <button class="primary-button" type="submit">예산 저장</button>
      </form>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);

  const form = modal.querySelector("[data-budget-form]");
  const catsBox = modal.querySelector("[data-budget-cats]");
  const leftEl = modal.querySelector("[data-budget-left]");
  const warnEl = modal.querySelector("[data-budget-warn]");

  const readValues = () => {
    const values = {};
    catsBox.querySelectorAll("input[data-cat-input]").forEach((input) => {
      values[input.dataset.catInput] = input.value;
    });
    return values;
  };
  const compute = () => {
    // 저장 시와 같은 하한 클램프를 적용해 표시 미배분과 실제 저장 계획을 일치시킨다
    const saving = Math.max(numberFromInput(form.elements.saving.value) || 0, requiredFloor);
    const envelopeSum = Object.values(readValues()).reduce((sum, value) => sum + (numberFromInput(value) || 0), 0);
    const left = income - fixedSum - saving - envelopeSum;
    leftEl.textContent = `${left < 0 ? "-" : ""}${money(Math.abs(left))}`;
    warnEl.classList.toggle("visible", left < 0);
  };

  // 카테고리 칸을 상태 기준으로 다시 그린다. 입력값은 values로 보존, 기본·커스텀 모두 이름변경 가능
  const renderCats = (values, focusName) => {
    const renamable = categoriesFor("expense");
    catsBox.innerHTML = categoryList()
      .map(
        (category, i) => `
      <div class="field">
        <label for="budgetEnv${i}">${escapeHtml(category)}${renamable.includes(category) ? ` <button type="button" class="inline-edit" data-cat-rename="${escapeHtml(category)}">이름변경</button>` : ""}</label>
        <input id="budgetEnv${i}" data-cat-input="${escapeHtml(category)}" inputmode="numeric" placeholder="봉투 없음" value="${escapeHtml(String(values[category] || ""))}" />
      </div>`,
      )
      .join("");
    catsBox.querySelectorAll("[data-cat-rename]").forEach((button) => {
      button.addEventListener("click", () => {
        const from = button.dataset.catRename;
        const input = window.prompt("새 이름 (8자 이내)", from);
        if (input === null) return;
        // 고아 봉투 이름과 겹치면 같은 이름 봉투가 이중으로 생기므로 함께 검증
        const to = validateNewCategory(input, [...categoriesFor("expense"), ...allBudgetEnvelopeNames()].filter((c) => c !== from));
        if (!to) {
          window.alert("빈 이름, 8자 초과, 이미 있는 이름은 쓸 수 없습니다.");
          return;
        }
        if (to === from) return;
        const kept = readValues();
        kept[to] = kept[from];
        delete kept[from];
        renameCategoryEverywhere("expense", from, to);
        render();
        renderCats(kept);
        compute();
      });
    });
    if (focusName) catsBox.querySelector(`input[data-cat-input="${CSS.escape(focusName)}"]`)?.focus();
  };
  renderCats(initialValues);

  modal.querySelector("[data-add-budget-category]").addEventListener("click", () => {
    const input = window.prompt("새 카테고리 이름 (8자 이내)");
    if (input === null) return;
    const name = validateNewCategory(input, categoriesFor("expense"));
    if (!name) {
      window.alert("빈 이름, 8자 초과, 이미 있는 이름은 쓸 수 없습니다.");
      return;
    }
    const kept = readValues();
    addCategoryToState("expense", name);
    render();
    renderCats(kept, name);
    compute();
  });

  form.addEventListener("input", compute);
  compute();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const savingInput = numberFromInput(form.elements.saving.value) || 0;
    const saving = Math.max(savingInput, requiredFloor);
    const values = readValues();
    const envelopes = categoryList()
      .map((category) => ({ category, amount: numberFromInput(values[category]) || 0 }))
      .filter((envelope) => envelope.amount > 0);
    setState((prev) => ({
      ...prev,
      budgets: { ...prev.budgets, [targetMonth]: { saving, envelopes } },
      toast:
        saving > savingInput
          ? `저축액은 필요 월저축 밑으로 못 내려 ${money(saving)}으로 저장했습니다.`
          : `${monthNum}월 예산을 저장했습니다.`,
    }));
    modal.remove();
    clearToastSoon();
  });
}

// 월급일 이후 앱을 열면 다음 달 예산 시트를 그 달에 한 번 자동으로 띄운다
function maybePromptBudget() {
  if (!state.hasOnboarded) return;
  if (document.querySelector(".modal-backdrop")) return;
  const payday = state.fixedItems.find((item) => item.active && item.type === "income")?.day || 0;
  const target = shouldPromptBudget(new Date(), payday, state.budgets, state.budgetPromptDismissed);
  if (!target) return;
  state = { ...state, budgetPromptDismissed: target };
  // 부팅 경로는 updatedAt을 갱신하지 않는다 — 스탬프하면 오래된 기기가 서버의 새 데이터를 덮어쓸 수 있다
  saveState({ stamp: false });
  openBudgetSheet(target);
}

/* ---------- 당겨서 새로고침 ---------- */

const ptrEl = document.querySelector("[data-ptr]");
let ptrStartY = null;
let ptrPull = 0;
let ptrBusy = false;

function ptrSet(pull) {
  ptrPull = pull;
  if (ptrEl && !ptrBusy) ptrEl.style.transform = pull > 0 ? `translate(-50%, ${Math.min(pull, 80) - 44}px)` : "";
}

async function ptrRefresh() {
  if (!ptrEl || ptrBusy) return;
  ptrBusy = true;
  ptrEl.style.transform = "";
  ptrEl.classList.add("busy");
  const minSpin = new Promise((resolve) => setTimeout(resolve, 700));
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.update();
  } catch {
    // 새 버전 확인 실패는 무시
  }
  let message = null;
  if (!syncEnabled()) {
    message = syncConfigured() ? "동기화가 꺼져 있습니다." : "서버 설정 대기 중입니다.";
  } else {
    try {
      message = await manualSync();
    } catch {
      message = "서버 연결 실패 · 나중에 다시 시도합니다.";
    }
  }
  await minSpin;
  ptrEl.classList.remove("busy");
  ptrBusy = false;
  if (message) {
    state.toast = message;
    render();
    clearToastSoon();
  }
}

document.addEventListener("touchstart", (event) => {
  ptrStartY = null;
  if (ptrBusy || window.scrollY > 0) return;
  if (document.querySelector(".modal-backdrop")) return; // 시트·온보딩 열림
  ptrStartY = event.touches[0].clientY;
}, { passive: true });

document.addEventListener("touchmove", (event) => {
  if (ptrStartY === null) return;
  const dy = event.touches[0].clientY - ptrStartY;
  if (dy <= 0 || window.scrollY > 0) {
    ptrSet(0);
    return;
  }
  ptrSet(dy * 0.4); // 저항감
}, { passive: true });

document.addEventListener("touchend", () => {
  if (ptrStartY === null) return;
  ptrStartY = null;
  const triggered = ptrPull >= 48;
  ptrSet(0);
  if (triggered) ptrRefresh();
});

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
      state = applyFixedItems({
        ...defaultState(),
        ...data,
        settings: { ...defaultState().settings, ...data.settings },
        savings: data.savings || [],
        categories: normalizeCategories(data),
        customCategories: {
          expense: data.customCategories?.expense || [],
          income: data.customCategories?.income || [],
        },
        budgets: data.budgets || {},
        toast: "백업을 복원했습니다.",
      });
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

/* ---------- 온보딩 위저드 (3스텝 + 피날레, body 모달, render()와 분리) ---------- */

const WIZARD_DEFAULT_TARGET_DATE = "2030-12-31";

function openOnboardingWizard() {
  const today = new Date();
  let step = 1; // 1 | 2 | 3 | "finale"

  const accounts = [
    { name: "", amount: "" },
    { name: "", amount: "" },
  ];
  let targetAmount = state.settings.targetAmount || 100000000;
  let targetDateMode = state.settings.targetDate && state.settings.targetDate !== WIZARD_DEFAULT_TARGET_DATE ? "custom" : "5y";
  let targetDate = targetDateMode === "custom" ? state.settings.targetDate : localDateString(addMonths(today, 60));
  let monthlySaving = "";
  let monthlyIncome = "";
  let fixedExpense = "";

  const modal = document.createElement("div");
  modal.className = "modal-backdrop wizard-backdrop";
  document.body.appendChild(modal);

  function accountsTotal() {
    return accounts.reduce((sum, a) => sum + (numberFromInput(a.amount) || 0), 0);
  }

  function topHtml(current) {
    return `
      <div class="wizard-top">
        <div class="wizard-dots">
          ${[1, 2, 3].map((n) => `<span class="wizard-dot ${n <= current ? "active" : ""}"></span>`).join("")}
        </div>
        ${current > 1 ? `<button type="button" class="wizard-back" data-wizard-back aria-label="뒤로">←</button>` : ""}
      </div>
    `;
  }

  function accountRowHtml(row, index) {
    const namePlaceholder = index === 0 ? "계좌 이름 (예: 토스뱅크)" : index === 1 ? "계좌 이름 (예: 키움증권)" : "계좌 이름";
    return `
      <div class="wizard-row wizard-account-row">
        <input class="wizard-row-input name" placeholder="${namePlaceholder}" value="${escapeHtml(row.name)}" data-account-index="${index}" data-field="name" />
        <input class="wizard-row-input" inputmode="numeric" placeholder="잔고" value="${escapeHtml(row.amount)}" data-account-index="${index}" data-field="amount" />
      </div>
    `;
  }

  function renderStep1() {
    return `
      <section class="wizard-card" role="dialog" aria-modal="true">
        ${topHtml(1)}
        <h2 class="wizard-question">현재 자산은?</h2>
        <div data-account-rows>${accounts.map((row, i) => accountRowHtml(row, i)).join("")}</div>
        <button type="button" class="wizard-add-account" data-wizard-add-account>+ 계좌 추가</button>
        <p class="wizard-feedback" data-wizard-feedback>현재 자산 ${readableMoney(accountsTotal())}</p>
        <p class="wizard-inline-warn" data-wizard-warn>이름 있는 계좌를 1개 이상 입력해 주세요.</p>
        <button type="button" class="wizard-cta" data-wizard-next>다음 →</button>
        ${syncConfigured() ? `<button type="button" class="wizard-sync-link" data-wizard-sync-link>이미 쓰던 기기가 있다면 — 동기화 키로 가져오기</button>` : ""}
      </section>
    `;
  }

  function step2Feedback() {
    const total = accountsTotal();
    const remaining = Math.max(0, targetAmount - total);
    if (remaining === 0) return { text: "지금 자산으로 이미 목표에 도달했어요", muted: false };
    if (targetDateMode === "bySaving") {
      const saving = numberFromInput(monthlySaving) || 0;
      if (saving <= 0) return { text: "월 저축액을 입력해 주세요", muted: true };
      const arrival = arrivalDate(remaining, saving, today);
      return arrival
        ? { text: `이 저축이면 ${arrival.getFullYear()}년 ${arrival.getMonth() + 1}월에 1억 달성해요`, muted: false }
        : { text: "월 저축액을 입력해 주세요", muted: true };
    }
    const required = requiredMonthlySaving(targetAmount, total, targetDate, today);
    return { text: `매달 ${Math.round(required / 10000).toLocaleString("ko-KR")}만원 페이스가 필요해요`, muted: false };
  }

  function renderStep2() {
    const segments = [
      { key: "3y", label: "3년" },
      { key: "5y", label: "5년" },
      { key: "2030", label: "2030년" },
      { key: "custom", label: "직접" },
      { key: "bySaving", label: "저축액으로" },
    ];
    const fb = step2Feedback();
    return `
      <section class="wizard-card" role="dialog" aria-modal="true">
        ${topHtml(2)}
        <h2 class="wizard-question">1억 달성 시점은?</h2>
        <div class="wizard-row">
          <label class="wizard-row-label" for="wizardTargetAmount">목표 금액</label>
          <input id="wizardTargetAmount" class="wizard-row-input" inputmode="numeric" value="${Number(targetAmount).toLocaleString("ko-KR")}" data-wizard-target-amount />
        </div>
        <div class="wizard-segment">
          ${segments.map((seg) => `<button type="button" class="wizard-segment-item ${targetDateMode === seg.key ? "active" : ""}" data-wizard-mode="${seg.key}">${seg.label}</button>`).join("")}
        </div>
        ${
          targetDateMode === "custom"
            ? `<div class="wizard-row wizard-date-row"><input type="date" class="wizard-row-input" value="${escapeHtml(targetDate)}" data-wizard-target-date /></div>`
            : targetDateMode === "bySaving"
              ? `<div class="wizard-row wizard-date-row">
                  <label class="wizard-row-label" for="wizardMonthlySaving">월 저축액</label>
                  <input id="wizardMonthlySaving" class="wizard-row-input" inputmode="numeric" placeholder="예: 1,200,000" value="${escapeHtml(monthlySaving)}" data-wizard-monthly-saving />
                </div>`
              : ""
        }
        <p class="wizard-feedback ${fb.muted ? "muted" : ""}" data-wizard-feedback>${fb.text}</p>
        <button type="button" class="wizard-cta" data-wizard-next>다음 →</button>
      </section>
    `;
  }

  function renderStep3() {
    return `
      <section class="wizard-card" role="dialog" aria-modal="true">
        ${topHtml(3)}
        <h2 class="wizard-question">한 달 현금흐름은?</h2>
        <div class="wizard-row">
          <label class="wizard-row-label" for="wizardMonthlyIncome">월 수입</label>
          <input id="wizardMonthlyIncome" class="wizard-row-input" inputmode="numeric" placeholder="예: 3200000" value="${escapeHtml(monthlyIncome)}" data-wizard-income />
        </div>
        <div class="wizard-row">
          <label class="wizard-row-label" for="wizardFixedExpense">고정지출 (선택)</label>
          <input id="wizardFixedExpense" class="wizard-row-input" inputmode="numeric" placeholder="예: 900000" value="${escapeHtml(fixedExpense)}" data-wizard-fixed />
        </div>
        <button type="button" class="wizard-cta mint" data-wizard-finale>오늘의 미션 보기 →</button>
      </section>
    `;
  }

  function renderFinale() {
    const total = accountsTotal();
    const remaining = Math.max(0, targetAmount - total);
    const income = numberFromInput(monthlyIncome) || 0;
    const fixed = numberFromInput(fixedExpense) || 0;
    const requiredSaving = requiredMonthlySaving(targetAmount, total, targetDate, today);
    // 실사용 미션과 동일: 월 수입 − 고정비를 그 달 전체 일수로 나눈 하루 몫(저축은 기록해야 줄어듦)
    const monthBudget = monthlyVariableBudget(income, fixed, 0);
    const daysTotal = daysInMonth(today.getFullYear(), today.getMonth() + 1);
    const todayBudget = Math.round(Math.max(0, monthBudget) / daysTotal);
    const arrival = arrivalDate(remaining, requiredSaving, today);
    const arrivalHtml = arrival
      ? `<p class="wizard-finale-sentence">이 페이스면 ${arrival.getFullYear()}년 ${arrival.getMonth() + 1}월에<br>1억 달성합니다.</p>`
      : "";
    const amountHtml =
      monthBudget > 0
        ? `<p class="wizard-finale-amount">${todayBudget.toLocaleString("ko-KR")}원</p>`
        : `<p class="wizard-finale-warn">월 수입이 고정비보다 적습니다. 시작 후 설정에서 월 수입·고정비를 확인해 주세요.</p>`;
    return `
      <section class="wizard-card wizard-finale" role="dialog" aria-modal="true">
        <p class="wizard-finale-label">오늘 쓸 수 있는 돈</p>
        ${amountHtml}
        ${arrivalHtml}
        <button type="button" class="wizard-finale-start" data-wizard-start>시작하기</button>
      </section>
    `;
  }

  function paint() {
    if (step === 1) modal.innerHTML = renderStep1();
    else if (step === 2) modal.innerHTML = renderStep2();
    else if (step === 3) modal.innerHTML = renderStep3();
    else modal.innerHTML = renderFinale();
    bindStep();
  }

  function updateFeedback() {
    const el = modal.querySelector("[data-wizard-feedback]");
    if (!el) return;
    if (step === 1) {
      el.textContent = `현재 자산 ${readableMoney(accountsTotal())}`;
      el.classList.remove("muted");
      return;
    }
    const fb = step2Feedback();
    el.textContent = fb.text;
    el.classList.toggle("muted", fb.muted);
  }

  function bindAccountRow(row) {
    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        const index = Number(input.dataset.accountIndex);
        const field = input.dataset.field;
        accounts[index][field] = input.value;
        if (field === "amount") updateFeedback();
        if (field === "name") {
          const warnEl = modal.querySelector("[data-wizard-warn]");
          if (warnEl && accounts.some((a) => a.name.trim())) warnEl.classList.remove("visible");
        }
      });
    });
  }

  function goStep1Next() {
    const namedCount = accounts.filter((a) => a.name.trim()).length;
    if (namedCount === 0) {
      modal.querySelector("[data-wizard-warn]")?.classList.add("visible");
      return;
    }
    step = 2;
    paint();
  }

  function goStep2Next() {
    if (targetDateMode === "bySaving") {
      const remaining = Math.max(0, targetAmount - accountsTotal());
      if (remaining > 0) {
        const saving = numberFromInput(monthlySaving) || 0;
        if (saving <= 0) {
          updateFeedback();
          return;
        }
        const arrival = arrivalDate(remaining, saving, today);
        if (arrival) targetDate = localDateString(arrival);
      } else {
        targetDate = localDateString(today);
      }
    }
    step = 3;
    paint();
  }

  function goFinale() {
    step = "finale";
    paint();
  }

  function goBack() {
    if (step === 2) step = 1;
    else if (step === 3) step = 2;
    paint();
  }

  function submitWizard() {
    const newAccounts = [];
    const balances = [];
    accounts.forEach((row) => {
      const name = row.name.trim();
      if (!name) return;
      const id = cryptoId();
      newAccounts.push({ id, name, order: newAccounts.length, active: true });
      balances.push({ accountId: id, amount: numberFromInput(row.amount) || 0 });
    });
    const total = balances.reduce((sum, b) => sum + b.amount, 0);
    const income = numberFromInput(monthlyIncome) || 0;
    const fixed = numberFromInput(fixedExpense) || 0;
    const requiredSaving = requiredMonthlySaving(targetAmount, total, targetDate, today);

    const autoItems = [];
    if (state.fixedItems.length === 0) {
      if (income > 0) autoItems.push({ id: cryptoId(), type: "income", name: "월급", amount: income, day: 25, category: "급여", active: true, startMonth: monthKey(today) });
      if (fixed > 0) autoItems.push({ id: cryptoId(), type: "expense", name: "고정비", amount: fixed, day: 1, category: "고정비", active: true, startMonth: monthKey(today) });
    }

    state = applyFixedItems({
      ...state,
      hasOnboarded: true,
      settings: { ...state.settings, targetAmount, targetDate, monthlyIncome: income, startDate: localDateString(today) },
      accounts: newAccounts,
      settlements: [{
        id: cryptoId(), month: monthKey(today), date: localDateString(today),
        balances, total, requiredSaving: Math.round(requiredSaving), monthlyIncome: income,
      }],
      fixedItems: [...state.fixedItems, ...autoItems],
      toast: "내 숫자로 시작합니다.",
    });
    saveState();
    modal.remove();
    render();
    clearToastSoon();
  }

  function bindStep() {
    modal.querySelector("[data-wizard-back]")?.addEventListener("click", goBack);

    if (step === 1) {
      modal.querySelectorAll(".wizard-account-row").forEach(bindAccountRow);
      modal.querySelector("[data-wizard-add-account]")?.addEventListener("click", () => {
        accounts.push({ name: "", amount: "" });
        const index = accounts.length - 1;
        const row = document.createElement("div");
        row.className = "wizard-row wizard-account-row";
        row.innerHTML = `
          <input class="wizard-row-input name" placeholder="계좌 이름" data-account-index="${index}" data-field="name" />
          <input class="wizard-row-input" inputmode="numeric" placeholder="잔고" data-account-index="${index}" data-field="amount" />
        `;
        modal.querySelector("[data-account-rows]")?.appendChild(row);
        bindAccountRow(row);
        row.querySelector("input")?.focus();
      });
      modal.querySelector("[data-wizard-next]")?.addEventListener("click", goStep1Next);
      modal.querySelector("[data-wizard-sync-link]")?.addEventListener("click", async () => {
        const input = window.prompt("다른 기기의 동기화 키를 붙여넣어 주세요.");
        if (!input?.trim()) return;
        try {
          const payload = await syncPullNow(input.trim());
          if (!payload) {
            window.alert("해당 키로 저장된 데이터가 없습니다.");
            return;
          }
          syncSetKey(input.trim());
          syncMarkSynced();
          modal.remove();
          applyServerState(payload, "서버 데이터를 가져왔습니다.");
        } catch {
          window.alert("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.");
        }
      });
    } else if (step === 2) {
      const amountInput = modal.querySelector("[data-wizard-target-amount]");
      amountInput?.addEventListener("input", () => {
        targetAmount = numberFromInput(amountInput.value) || 0;
        updateFeedback();
      });
      modal.querySelectorAll("[data-wizard-mode]").forEach((button) => {
        button.addEventListener("click", () => {
          targetDateMode = button.dataset.wizardMode;
          if (targetDateMode === "3y") targetDate = localDateString(addMonths(today, 36));
          else if (targetDateMode === "5y") targetDate = localDateString(addMonths(today, 60));
          else if (targetDateMode === "2030") targetDate = WIZARD_DEFAULT_TARGET_DATE;
          paint();
        });
      });
      const dateInput = modal.querySelector("[data-wizard-target-date]");
      dateInput?.addEventListener("input", () => {
        targetDate = dateInput.value || targetDate;
        updateFeedback();
      });
      const savingInput = modal.querySelector("[data-wizard-monthly-saving]");
      savingInput?.addEventListener("input", () => {
        monthlySaving = savingInput.value;
        updateFeedback();
      });
      modal.querySelector("[data-wizard-next]")?.addEventListener("click", goStep2Next);
    } else if (step === 3) {
      const incomeInput = modal.querySelector("[data-wizard-income]");
      incomeInput?.addEventListener("input", () => { monthlyIncome = incomeInput.value; });
      const fixedInput = modal.querySelector("[data-wizard-fixed]");
      fixedInput?.addEventListener("input", () => { fixedExpense = fixedInput.value; });
      modal.querySelector("[data-wizard-finale]")?.addEventListener("click", goFinale);
    } else {
      modal.querySelector("[data-wizard-start]")?.addEventListener("click", submitWizard);
    }
  }

  modal.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    if (!(event.target instanceof HTMLElement)) return;
    if (!event.target.matches('input[inputmode="numeric"]')) return;
    event.preventDefault();
    if (step === 1) goStep1Next();
    else if (step === 2) goStep2Next();
    else if (step === 3) goFinale();
  });

  paint();
}

let state = applyFixedItems(loadState());
saveState({ stamp: false });
render();
if (!state.hasOnboarded && !document.querySelector(".wizard-backdrop")) openOnboardingWizard();
runStartupSync().finally(() => maybePromptBudget());

if ("serviceWorker" in navigator) {
  // 새 배포가 활성화되면 화면을 한 번 자동 새로고침 — 옛 캐시에 갇히지 않게 한다.
  // 첫 설치(controller 없음)에는 걸지 않아 불필요한 재로딩을 피한다
  let swRefreshing = false;
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (swRefreshing) return;
      swRefreshing = true;
      location.reload();
    });
  }
  navigator.serviceWorker
    .register("./sw.js")
    .then((registration) => registration.update())
    .catch(() => {});
}
