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
    customCategories: { expense: [], income: [] },
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
      customCategories: {
        expense: parsed.customCategories?.expense || [],
        income: parsed.customCategories?.income || [],
      },
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
  const base = type === "income" ? incomeCategories : expenseCategories;
  return [...base, ...(state.customCategories?.[type] || [])];
}

function openTransactionSheet(type) {
  let selectedCategory = categoriesFor(type)[0];
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
  const renderChips = () => {
    const categories = categoriesFor(type);
    chipsBox.innerHTML = categories
      .map((name, i) => `<button class="chip ${name === selectedCategory ? "active" : ""}" type="button" data-pick-category="${i}">${escapeHtml(name)}</button>`)
      .join("") + `<button class="chip chip-add" type="button" data-add-category>+ 추가</button>`;
    chipsBox.querySelectorAll("[data-pick-category]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedCategory = categoriesFor(type)[Number(button.dataset.pickCategory)];
        renderChips();
      });
    });
    chipsBox.querySelector("[data-add-category]").addEventListener("click", () => {
      const input = window.prompt("새 카테고리 이름 (8자 이내)");
      if (input === null) return;
      const name = validateNewCategory(input, categoriesFor(type));
      if (!name) {
        window.alert("빈 이름, 8자 초과, 이미 있는 이름은 쓸 수 없습니다.");
        return;
      }
      state = {
        ...state,
        customCategories: { ...state.customCategories, [type]: [...(state.customCategories?.[type] || []), name] },
      };
      saveState();
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
  bindRecordEvents();
  bindFlowEvents();
  bindSettingsEvents();
}

/* ---------- 기록 탭 ---------- */

function renderRecord(m) {
  const recent = state.transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
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
  const sorted = state.settlements.slice().sort((a, b) => b.month.localeCompare(a.month));
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

function settingsCategoryRowHtml(type, name, index) {
  return `
    <button type="button" class="settings-row" data-cat-type="${type}" data-cat-index="${index}">
      <span class="settings-row-main">
        <span>${escapeHtml(name)}</span>
        <span class="sub">${type === "income" ? "수입" : "지출"}</span>
      </span>
      <span class="settings-row-side"><span class="chev">›</span></span>
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
        <div class="section-title-row"><h2 class="section-title">카테고리</h2><span class="section-note">직접 추가한 것만</span></div>
        ${
          state.customCategories.expense.length + state.customCategories.income.length
            ? `<div class="settings-list">${["expense", "income"]
                .flatMap((type) => state.customCategories[type].map((name, i) => settingsCategoryRowHtml(type, name, i)))
                .join("")}</div>`
            : `<p class="empty-state">기록 입력의 ‘+ 추가’ 칩으로 만듭니다.</p>`
        }
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
    setState((prev) => ({
      ...prev,
      accounts: [...prev.accounts, { id: cryptoId(), name: name.trim(), order: prev.accounts.length, active: true }],
      toast: "계좌를 추가했습니다.",
    }));
    clearToastSoon();
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
      const name = state.customCategories?.[type]?.[Number(button.dataset.catIndex)];
      if (name) openCategoryManageSheet(type, name);
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
      const server = await syncPullNow();
      const direction = syncDirection(state.updatedAt, server?.updatedAt);
      if (direction === "pull") {
        applyServerState(server);
        return;
      }
      if (direction === "push") {
        const { toast, ...persisted } = state;
        await syncPushNow(persisted);
      }
      setState((prev) => ({ ...prev, toast: "동기화 완료 · 최신 상태입니다." }));
      clearToastSoon();
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
    const others = categoriesFor(type).filter((c) => c !== name);
    const next = validateNewCategory(input, others);
    if (!next) {
      window.alert("빈 이름, 8자 초과, 이미 있는 이름은 쓸 수 없습니다.");
      return;
    }
    if (next === name) { modal.remove(); return; }
    const migrated = renameCategoryInRecords(state.transactions, state.fixedItems, name, next);
    setState((prev) => ({
      ...prev,
      transactions: migrated.transactions,
      fixedItems: migrated.fixedItems,
      customCategories: {
        ...prev.customCategories,
        [type]: prev.customCategories[type].map((c) => (c === name ? next : c)),
      },
      toast: "과거 기록까지 이름을 바꿨습니다.",
    }));
    modal.remove();
    clearToastSoon();
  });
  modal.querySelector("[data-manage-delete]").addEventListener("click", () => {
    if (!window.confirm("카테고리를 삭제할까요? 과거 기록은 그대로 남습니다.")) return;
    setState((prev) => ({
      ...prev,
      customCategories: {
        ...prev.customCategories,
        [type]: prev.customCategories[type].filter((c) => c !== name),
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
        customCategories: {
          expense: data.customCategories?.expense || [],
          income: data.customCategories?.income || [],
        },
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
    const monthBudget = monthlyVariableBudget(income, fixed, requiredSaving);
    const daysTotal = daysInMonth(today.getFullYear(), today.getMonth() + 1);
    const daysLeft = daysTotal - today.getDate() + 1;
    const todayBudget = Math.round(Math.max(0, monthBudget) / daysLeft);
    const arrival = arrivalDate(remaining, requiredSaving, today);
    const arrivalHtml = arrival
      ? `<p class="wizard-finale-sentence">이 페이스면 ${arrival.getFullYear()}년 ${arrival.getMonth() + 1}월에<br>1억 달성합니다.</p>`
      : "";
    const amountHtml =
      monthBudget > 0
        ? `<p class="wizard-finale-amount">${todayBudget.toLocaleString("ko-KR")}원</p>`
        : `<p class="wizard-finale-warn">이 목표일은 현재 수입으로 어렵습니다. 시작 후 설정에서 목표일·월 수입을 조정해 주세요.</p>`;
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
runStartupSync();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
