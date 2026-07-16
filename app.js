const STORE_KEY = "one_hundred_million_mobile_v1";

const tabs = [
  { id: "reality", label: "현실" },
  { id: "record", label: "기록" },
  { id: "flow", label: "흐름" },
  { id: "settings", label: "설정" },
];

const expenseCategories = ["식비", "카페", "교통", "생활", "구독", "고정비", "기타"];
const incomeCategories = ["급여", "부수입", "이자", "환급", "기타"];

const defaultState = () => {
  const today = new Date();
  const startDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`;

  return {
    activeTab: "reality",
    inputMode: "expense",
    selectedCategory: "식비",
    hasOnboarded: false,
    toast: "",
    settings: {
      targetAmount: 100000000,
      targetDate: "2030-12-31",
      startNetWorth: 26580000,
      startVariableAsset: 15700000,
      monthlySavingGoal: 1000000,
      startDate,
    },
    variableAsset: {
      amount: 15700000,
      updatedAt: localDateString(today),
      source: "sample",
      imageName: "",
      history: [],
    },
    transactions: [
      {
        id: cryptoId(),
        type: "expense",
        amount: 12000,
        category: "식비",
        title: "점심",
        date: localDateString(today),
        source: "manual",
      },
      {
        id: cryptoId(),
        type: "expense",
        amount: 4500,
        category: "카페",
        title: "커피",
        date: localDateString(today),
        source: "manual",
      },
    ],
    fixedItems: [
      {
        id: cryptoId(),
        type: "income",
        name: "월급",
        amount: 3200000,
        day: 25,
        category: "급여",
        active: true,
        startMonth: monthKey(today),
      },
      {
        id: cryptoId(),
        type: "expense",
        name: "월세",
        amount: 500000,
        day: 1,
        category: "고정비",
        active: true,
        startMonth: monthKey(today),
      },
      {
        id: cryptoId(),
        type: "expense",
        name: "통신비",
        amount: 89000,
        day: 15,
        category: "고정비",
        active: true,
        startMonth: monthKey(today),
      },
      {
        id: cryptoId(),
        type: "expense",
        name: "구독",
        amount: 14900,
        day: 7,
        category: "구독",
        active: true,
        startMonth: monthKey(today),
      },
    ],
  };
};

let state = loadState();
state = applyFixedItems(state).state;
saveState();
render();

function loadState() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (!saved) return defaultState();
    const parsed = JSON.parse(saved);
    return {
      ...defaultState(),
      ...parsed,
      settings: { ...defaultState().settings, ...parsed.settings },
      variableAsset: { ...defaultState().variableAsset, ...parsed.variableAsset },
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

function render() {
  const app = document.querySelector("#app");
  const metrics = getMetrics(state);
  app.innerHTML = `
    <section class="screen">
      ${renderScreen(metrics)}
    </section>
    ${renderNav()}
    ${state.hasOnboarded ? "" : renderOnboarding(metrics)}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;
  bindEvents();
}

function renderScreen(metrics) {
  if (state.activeTab === "record") return renderRecord(metrics);
  if (state.activeTab === "flow") return renderFlow(metrics);
  if (state.activeTab === "settings") return renderSettings(metrics);
  return renderReality(metrics);
}

function renderHeader() {
  return `
    <div class="screen-header">
      <div>
        <h1 class="title">1억 모으기</h1>
      </div>
      <div class="date-pill">${formatShortDate(new Date())}</div>
    </div>
  `;
}

function renderOnboarding(metrics) {
  return `
    <div class="modal-backdrop onboarding-backdrop">
      <section class="sheet onboarding-sheet" role="dialog" aria-modal="true">
        <div class="sheet-header">
          <h2 class="sheet-title">처음 숫자만 맞추기</h2>
          <button class="ghost-button" data-skip-onboarding>나중에</button>
        </div>
        <p class="onboarding-copy">3가지만 넣으면 1억까지 남은 거리와 속도가 바로 계산됩니다.</p>
        <form class="form-grid" data-onboarding-form>
          <div class="field">
            <label for="onboardNetWorth">현재 자산</label>
            <input id="onboardNetWorth" name="netWorth" inputmode="numeric" value="${Math.round(metrics.currentNetWorth)}" autofocus />
          </div>
          <div class="field">
            <label for="onboardVariableAsset">주식·코인 등 변동자산</label>
            <input id="onboardVariableAsset" name="variableAsset" inputmode="numeric" value="${Math.round(metrics.variableAssetAmount)}" />
          </div>
          <div class="field">
            <label for="onboardMonthlySaving">한 달에 현실적으로 모을 돈</label>
            <input id="onboardMonthlySaving" name="monthlySaving" inputmode="numeric" value="${state.settings.monthlySavingGoal}" />
          </div>
          <div class="two-col">
            <div class="field">
              <label for="onboardFixedIncome">대표 고정수입</label>
              <input id="onboardFixedIncome" name="fixedIncome" inputmode="numeric" placeholder="예: 3200000" />
            </div>
            <div class="field">
              <label for="onboardFixedExpense">대표 고정비</label>
              <input id="onboardFixedExpense" name="fixedExpense" inputmode="numeric" placeholder="예: 900000" />
            </div>
          </div>
          <button class="primary-button" type="submit">시작하기</button>
        </form>
      </section>
    </div>
  `;
}

function renderReality(metrics) {
  const arrivalText = metrics.arrivalDate ? formatYearMonth(metrics.arrivalDate) : "속도 부족";

  return `
    ${renderHeader()}
    <section class="card hero-card simple-hero">
      <p class="hero-label">1억까지 남은 금액</p>
      <h2 class="hero-money">${readableMoney(metrics.remaining)}</h2>
      <p class="hero-sub simple-asset">현재 자산 ${readableMoney(metrics.currentNetWorth)}</p>
      <div class="progress-track">
        <div class="progress-fill" style="width:${metrics.progress}%"></div>
      </div>
    </section>

    <section class="section card simple-arrival">
      <p class="simple-label">지금 속도로 하면</p>
      <strong>${arrivalText}</strong>
      <button class="basis-button" data-open-speed>${metrics.speedBasisLabel}</button>
    </section>

    <section class="section quick-actions">
      <button class="action-button expense" data-open-transaction="expense">+ 지출</button>
      <button class="action-button income" data-open-transaction="income">+ 수입</button>
    </section>

    <section class="section grid-2">
      <article class="card stat-card simple-stat">
        <p class="stat-label">이번달 수입</p>
        <p class="stat-value positive">${money(metrics.monthIncome)}</p>
      </article>
      <article class="card stat-card simple-stat">
        <p class="stat-label">이번달 지출</p>
        <p class="stat-value negative">${money(metrics.monthExpense)}</p>
      </article>
    </section>
  `;
}

function renderRealityDetail(metrics) {
  const sentenceClass = metrics.monthlyGap >= 0 ? "good" : metrics.projectedMonthlySaving > 0 ? "warn" : "";
  const arrivalText = metrics.arrivalDate ? formatYearMonth(metrics.arrivalDate) : "속도 부족";
  const gapText =
    metrics.monthlyGap >= 0
      ? `현재 페이스면 목표보다 매달 ${money(metrics.monthlyGap)} 여유가 있습니다.`
      : `목표 날짜에 맞추려면 매달 ${money(Math.abs(metrics.monthlyGap))} 더 필요합니다.`;

  return `
    ${renderHeader("오늘의 현실")}
    <section class="card hero-card">
      <div class="hero-top">
        <div>
          <p class="hero-label">1억까지 남은 돈</p>
          <h2 class="hero-money">${money(metrics.remaining)}</h2>
          <p class="hero-sub">현재 순자산 ${money(metrics.currentNetWorth)}</p>
        </div>
        <div class="progress-ring" style="--progress:${metrics.progress}%">
          <span>${metrics.progress.toFixed(1)}%</span>
        </div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width:${metrics.progress}%"></div>
      </div>
      <div class="hero-meta">
        <div class="metric-box">
          <p>예상 도착</p>
          <strong>${arrivalText}</strong>
        </div>
        <div class="metric-box">
          <p>이번 달 저축</p>
          <strong>${money(metrics.monthSaving)}</strong>
        </div>
      </div>
    </section>

    <section class="section card reality-line ${sentenceClass}">
      <p>${metrics.arrivalGapText}</p>
      <span>${gapText}</span>
    </section>

    <section class="section quick-actions">
      <button class="action-button expense" data-open-transaction="expense">+ 지출</button>
      <button class="action-button income" data-open-transaction="income">+ 수입</button>
    </section>

    <section class="section grid-3">
      <article class="card stat-card">
        <p class="stat-label">필요 월저축</p>
        <p class="stat-value">${money(metrics.neededMonthlySaving)}</p>
      </article>
      <article class="card stat-card">
        <p class="stat-label">예상 월저축</p>
        <p class="stat-value ${metrics.projectedMonthlySaving >= 0 ? "positive" : "negative"}">${money(metrics.projectedMonthlySaving)}</p>
      </article>
      <article class="card stat-card">
        <p class="stat-label">월 차이</p>
        <p class="stat-value ${metrics.monthlyGap >= 0 ? "positive" : "negative"}">${signedMoney(metrics.monthlyGap)}</p>
      </article>
    </section>

    <section class="section card summary-card">
      <div class="section-title-row">
        <h2 class="section-title">이번 달</h2>
        <span class="section-note">자동 기록 포함</span>
      </div>
      ${moneyRow("수입", metrics.monthIncome)}
      ${moneyRow("지출", metrics.monthExpense)}
      ${moneyRow("저축", metrics.monthSaving)}
      ${moneyRow("저축률", `${metrics.savingRate.toFixed(1)}%`)}
    </section>

    <section class="section card summary-card">
      <div class="section-title-row">
        <h2 class="section-title">다음 자동 기록</h2>
        <button class="ghost-button" data-tab="settings">관리</button>
      </div>
      ${
        metrics.nextFixed
          ? moneyRow(
              `${metrics.nextFixed.name} · D-${metrics.nextFixed.daysLeft}`,
              `${metrics.nextFixed.type === "income" ? "+" : "-"}${money(metrics.nextFixed.amount)}`,
            )
          : `<div class="empty-state">등록된 고정 항목이 없습니다.</div>`
      }
    </section>
  `;
}

function renderRecord(metrics) {
  return `
    ${renderHeader("빠른 기록")}
    <section class="quick-actions">
      <button class="action-button expense" data-open-transaction="expense">+ 지출</button>
      <button class="action-button income" data-open-transaction="income">+ 수입</button>
    </section>

    <section class="section card summary-card">
      <div class="section-title-row">
        <h2 class="section-title">입력 후 현실 변화</h2>
        <span class="section-note">즉시 반영</span>
      </div>
      ${moneyRow("현재 순자산", metrics.currentNetWorth)}
      ${moneyRow("1억까지", metrics.remaining)}
      ${moneyRow("예상 도착", metrics.arrivalDate ? formatYearMonth(metrics.arrivalDate) : "속도 부족")}
    </section>

    <section class="section">
      <div class="section-title-row">
        <h2 class="section-title">최근 기록</h2>
        <span class="section-note">${state.transactions.length}건</span>
      </div>
      ${renderTransactionList(state.transactions.slice().sort(sortByDateDesc).slice(0, 12))}
    </section>
  `;
}

function renderFlow(metrics) {
  const max = Math.max(metrics.monthIncome, metrics.monthExpense, Math.abs(metrics.monthSaving), 1);
  return `
    ${renderHeader("돈의 흐름")}
    <section class="card chart-card">
      <div class="section-title-row">
        <h2 class="section-title">이번 달 구조</h2>
        <span class="section-note">${formatYearMonth(new Date())}</span>
      </div>
      ${barRow("수입", metrics.monthIncome, max, "income")}
      ${barRow("지출", metrics.monthExpense, max, "expense")}
      ${barRow("저축", metrics.monthSaving, max, "saving")}
    </section>

    <section class="section card summary-card asset-card">
      <div class="section-title-row">
        <h2 class="section-title">변동자산</h2>
        <span class="section-note">${metrics.variableAssetAgeText}</span>
      </div>
      ${moneyRow("현재 평가액", metrics.variableAssetAmount)}
      ${moneyRow("기준 대비", signedMoney(metrics.variableAssetDelta))}
      <button class="secondary-button" data-open-variable>캡쳐로 업데이트</button>
      ${renderVariableHistory()}
    </section>

    <section class="section card chart-card">
      <div class="section-title-row">
        <h2 class="section-title">최근 3개월 저축 추세</h2>
        <span class="section-note">${metrics.speedBasisLabel}</span>
      </div>
      ${renderSavingTrend(metrics.speedMonths)}
    </section>

    <section class="section card reality-line ${metrics.fixedExpenseRate >= 35 ? "warn" : "good"}">
      <p>고정비가 월수입의 ${metrics.fixedExpenseRate.toFixed(1)}%입니다.</p>
      <span>${metrics.fixedExpenseRate >= 35 ? "줄일 수 있는 고정 항목을 먼저 보는 게 빠릅니다." : "고정비 압박은 아직 관리 가능한 범위입니다."}</span>
    </section>

    <section class="section">
      <div class="section-title-row">
        <h2 class="section-title">지출 카테고리</h2>
        <span class="section-note">이번 달</span>
      </div>
      ${renderCategoryList(metrics.categoryExpenses)}
    </section>
  `;
}

function renderSettings(metrics) {
  const fixedIncomeCount = state.fixedItems.filter((item) => item.type === "income" && item.active).length;
  const fixedExpenseCount = state.fixedItems.filter((item) => item.type === "expense" && item.active).length;
  return `
    ${renderHeader("설정")}
    <div class="settings-stack">
      <section class="card form-card">
        <div class="section-title-row">
          <h2 class="section-title">목표</h2>
          <span class="section-note">현재 ${metrics.progress.toFixed(1)}%</span>
        </div>
        <form class="form-grid" data-settings-form>
          <div class="field">
            <label for="targetAmount">목표 금액</label>
            <input id="targetAmount" name="targetAmount" inputmode="numeric" value="${state.settings.targetAmount}" />
          </div>
          <div class="field">
            <label for="startNetWorth">시작 순자산</label>
            <input id="startNetWorth" name="startNetWorth" inputmode="numeric" value="${state.settings.startNetWorth}" />
          </div>
          <div class="field">
            <label for="startVariableAsset">시작 변동자산 평가액</label>
            <input id="startVariableAsset" name="startVariableAsset" inputmode="numeric" value="${state.settings.startVariableAsset}" />
          </div>
          <div class="field">
            <label for="monthlySavingGoal">월 목표 저축액</label>
            <input id="monthlySavingGoal" name="monthlySavingGoal" inputmode="numeric" value="${state.settings.monthlySavingGoal}" />
          </div>
          <div class="two-col">
            <div class="field">
              <label for="startDate">시작일</label>
              <input id="startDate" name="startDate" type="date" value="${state.settings.startDate}" />
            </div>
            <div class="field">
              <label for="targetDate">목표일</label>
              <input id="targetDate" name="targetDate" type="date" value="${state.settings.targetDate}" />
            </div>
          </div>
          <button class="primary-button" type="submit">목표 저장</button>
        </form>
      </section>

      <section class="card summary-card">
        <div class="section-title-row">
          <h2 class="section-title">고정 항목</h2>
          <span class="section-note">수입 ${fixedIncomeCount} · 지출 ${fixedExpenseCount}</span>
        </div>
        <button class="secondary-button" data-open-fixed>고정 항목 추가</button>
        <div class="section fixed-list">
          ${renderFixedList()}
        </div>
      </section>

      <section class="card summary-card">
        <div class="section-title-row">
          <h2 class="section-title">데이터</h2>
          <span class="section-note">이 기기에 저장</span>
        </div>
        <div class="button-row">
          <button class="secondary-button" data-export-data>백업</button>
          <button class="secondary-button" data-import-data>복원</button>
        </div>
        <input class="hidden-file" type="file" accept="application/json,.json" data-import-file />
        <div class="button-row section">
          <button class="secondary-button" data-reset-demo>샘플 복원</button>
          <button class="danger-button" data-clear-records>기록 초기화</button>
        </div>
      </section>
    </div>
  `;
}

function renderNav() {
  return `
    <nav class="bottom-nav" aria-label="하단 메뉴">
      ${tabs
        .map(
          (tab) => `
            <button class="nav-button ${state.activeTab === tab.id ? "active" : ""}" data-tab="${tab.id}">
              ${tab.label}
            </button>
          `,
        )
        .join("")}
    </nav>
  `;
}

function renderTransactionList(transactions) {
  if (!transactions.length) {
    return `<div class="card empty-state">아직 기록이 없습니다.</div>`;
  }
  return `
    <div class="transaction-list">
      ${transactions
        .map(
          (item) => `
            <article class="transaction-item">
              <div class="item-main">
                <p class="item-title">${escapeHtml(item.title || item.category)}</p>
                <p class="item-sub">${formatDate(parseDate(item.date))} · ${escapeHtml(item.category)}${item.source === "fixed" ? " · 자동" : ""}</p>
              </div>
              <div>
                <div class="item-amount ${item.type}">${item.type === "income" ? "+" : "-"}${money(item.amount)}</div>
                ${item.source === "fixed" ? "" : `<button class="ghost-button" data-delete-transaction="${item.id}">삭제</button>`}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderCategoryList(categoryExpenses) {
  const entries = Object.entries(categoryExpenses).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map((entry) => entry[1]), 1);
  if (!entries.length) {
    return `<div class="card empty-state">이번 달 지출 기록이 없습니다.</div>`;
  }
  return `
    <div class="category-list">
      ${entries
        .map(
          ([name, amount]) => `
            <article class="card category-card">
              <div class="category-top">
                <strong>${escapeHtml(name)}</strong>
                <strong>${money(amount)}</strong>
              </div>
              <div class="mini-track">
                <div class="mini-fill" style="width:${Math.min(100, (amount / max) * 100)}%"></div>
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSpeedMonthList(months) {
  if (!months?.length) {
    return `<div class="empty-state">아직 비교할 월별 기록이 없습니다.</div>`;
  }
  return `
    <div class="mini-list">
      ${months
        .map(
          (item) => `
            <div class="mini-list-row">
              <span>${formatMonthKey(item.month)}${item.count ? "" : " · 기록 없음"}</span>
              <strong class="${item.saving >= 0 ? "positive" : "negative"}">${signedMoney(item.saving)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderVariableHistory() {
  const history = state.variableAsset?.history || [];
  if (!history.length) {
    return `<div class="asset-history empty-state">아직 업데이트 이력이 없습니다.</div>`;
  }
  return `
    <div class="asset-history">
      <p class="history-title">최근 업데이트</p>
      ${history
        .slice()
        .sort((a, b) => parseDate(b.date) - parseDate(a.date))
        .slice(0, 3)
        .map(
          (item) => `
            <div class="mini-list-row">
              <span>${formatDate(parseDate(item.date))}${item.imageName ? ` · ${escapeHtml(item.imageName)}` : ""}</span>
              <strong class="${item.delta >= 0 ? "positive" : "negative"}">${signedMoney(item.delta)}</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSavingTrend(months) {
  if (!months?.length) {
    return `<div class="empty-state">아직 월별 기록이 없습니다.</div>`;
  }
  const max = Math.max(...months.map((item) => Math.abs(item.saving)), 1);
  return `
    <div class="trend-list">
      ${months
        .map(
          (item) => `
            <div class="bar-row compact">
              <div class="bar-label">${formatMonthKey(item.month)}</div>
              <div class="bar-track">
                <div class="bar-fill ${item.saving >= 0 ? "income" : "expense"}" style="width:${Math.min(100, (Math.abs(item.saving) / max) * 100)}%"></div>
              </div>
              <div class="bar-value">${item.count ? signedMoney(item.saving) : "기록 없음"}</div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderFixedList() {
  if (!state.fixedItems.length) {
    return `<div class="empty-state">매달 자동으로 찍힐 수입과 지출을 등록하세요.</div>`;
  }
  return state.fixedItems
    .slice()
    .sort((a, b) => a.day - b.day)
    .map(
      (item) => `
        <article class="fixed-item">
          <div class="item-main">
            <p class="item-title">${escapeHtml(item.name)}</p>
            <p class="item-sub">
              <span class="pill ${item.type}">${item.type === "income" ? "고정수입" : "고정비"}</span>
              매월 ${item.day}일 · ${escapeHtml(item.category)} · ${item.active ? "활성" : "꺼짐"}
            </p>
          </div>
          <div>
            <div class="item-amount ${item.type}">${item.type === "income" ? "+" : "-"}${money(item.amount)}</div>
            <div class="fixed-actions">
              <button class="ghost-button" data-toggle-fixed="${item.id}">${item.active ? "끄기" : "켜기"}</button>
              <button class="ghost-button" data-delete-fixed="${item.id}">삭제</button>
            </div>
          </div>
        </article>
      `,
    )
    .join("");
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setState((prev) => ({ ...prev, activeTab: button.dataset.tab }));
    });
  });

  document.querySelectorAll("[data-open-transaction]").forEach((button) => {
    button.addEventListener("click", () => openTransactionSheet(button.dataset.openTransaction));
  });

  document.querySelector("[data-open-speed]")?.addEventListener("click", () => {
    openSpeedSheet(getMetrics(state));
  });

  document.querySelector("[data-skip-onboarding]")?.addEventListener("click", () => {
    setState((prev) => ({ ...prev, hasOnboarded: true, toast: "샘플 상태로 시작합니다." }));
    clearToastSoon();
  });

  document.querySelector("[data-onboarding-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const today = new Date();
    const netWorth = numberFromInput(form.get("netWorth"));
    const variableAsset = numberFromInput(form.get("variableAsset"));
    const monthlySaving = numberFromInput(form.get("monthlySaving"));
    const fixedIncome = numberFromInput(form.get("fixedIncome"));
    const fixedExpense = numberFromInput(form.get("fixedExpense"));
    const fixedItems = [];

    if (fixedIncome > 0) {
      fixedItems.push(createFixedItem("income", "월급", fixedIncome, 25, "급여", today));
    }
    if (fixedExpense > 0) {
      fixedItems.push(createFixedItem("expense", "고정비", fixedExpense, 1, "고정비", today));
    }

    setState((prev) => {
      const next = {
        ...prev,
        hasOnboarded: true,
        settings: {
          ...prev.settings,
          startNetWorth: netWorth,
          startVariableAsset: variableAsset,
          monthlySavingGoal: monthlySaving,
          startDate: localDateString(today),
        },
        variableAsset: {
          amount: variableAsset,
          updatedAt: localDateString(today),
          source: "onboarding",
          imageName: "",
          history: [],
        },
        transactions: [],
        fixedItems,
        toast: "내 숫자로 시작합니다.",
      };
      return applyFixedItems(next).state;
    });
    clearToastSoon();
  });

  document.querySelector("[data-settings-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const startVariableAsset = numberFromInput(form.get("startVariableAsset"));
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        targetAmount: numberFromInput(form.get("targetAmount")),
        startNetWorth: numberFromInput(form.get("startNetWorth")),
        startVariableAsset,
        monthlySavingGoal: numberFromInput(form.get("monthlySavingGoal")),
        startDate: String(form.get("startDate")),
        targetDate: String(form.get("targetDate")),
      },
      variableAsset:
        prev.variableAsset?.source === "screenshot"
          ? prev.variableAsset
          : {
              ...prev.variableAsset,
              amount: startVariableAsset,
              updatedAt: localDateString(new Date()),
              source: "baseline",
            },
      toast: "목표가 저장됐습니다.",
    }));
    clearToastSoon();
  });

  document.querySelector("[data-open-fixed]")?.addEventListener("click", openFixedSheet);
  document.querySelector("[data-open-variable]")?.addEventListener("click", openVariableAssetSheet);
  document.querySelector("[data-export-data]")?.addEventListener("click", exportData);
  document.querySelector("[data-import-data]")?.addEventListener("click", () => {
    document.querySelector("[data-import-file]")?.click();
  });
  document.querySelector("[data-import-file]")?.addEventListener("change", importData);

  document.querySelectorAll("[data-delete-transaction]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deleteTransaction;
      setState((prev) => ({
        ...prev,
        transactions: prev.transactions.filter((item) => item.id !== id),
        toast: "기록을 삭제했습니다.",
      }));
      clearToastSoon();
    });
  });

  document.querySelectorAll("[data-toggle-fixed]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.toggleFixed;
      const next = {
        ...state,
        fixedItems: state.fixedItems.map((item) =>
          item.id === id ? { ...item, active: !item.active } : item,
        ),
        toast: "고정 항목 상태를 바꿨습니다.",
      };
      const applied = applyFixedItems(next).state;
      state = applied;
      saveState();
      render();
      clearToastSoon();
    });
  });

  document.querySelectorAll("[data-delete-fixed]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deleteFixed;
      setState((prev) => ({
        ...prev,
        fixedItems: prev.fixedItems.filter((item) => item.id !== id),
        toast: "고정 항목을 삭제했습니다.",
      }));
      clearToastSoon();
    });
  });

  document.querySelector("[data-clear-records]")?.addEventListener("click", () => {
    setState((prev) => ({
      ...prev,
      transactions: [],
      toast: "기록을 초기화했습니다.",
    }));
    clearToastSoon();
  });

  document.querySelector("[data-reset-demo]")?.addEventListener("click", () => {
    state = applyFixedItems({ ...defaultState(), hasOnboarded: true }).state;
    state.toast = "샘플 데이터를 복원했습니다.";
    saveState();
    render();
    clearToastSoon();
  });
}

function openSpeedSheet(metrics) {
  const arrivalText = metrics.arrivalDate ? formatYearMonth(metrics.arrivalDate) : "속도 부족";
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">계산 기준</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <div class="speed-summary">
        <p>지금 기준</p>
        <strong>${arrivalText}</strong>
        <span>${metrics.speedBasisLabel}</span>
      </div>
      <div class="money-row">
        <span>1억까지 남은 금액</span>
        <strong>${readableMoney(metrics.remaining)}</strong>
      </div>
      <div class="money-row">
        <span>계산에 쓴 월 저축액</span>
        <strong>${readableMoney(metrics.speedMonthlySaving)}</strong>
      </div>
      <div class="section">
        <div class="section-title-row">
          <h3 class="section-title">최근 완료 3개월</h3>
          <span class="section-note">데이터가 쌓이면 자동 전환</span>
        </div>
        ${renderSpeedMonthList(metrics.speedMonths)}
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);
}

function openTransactionSheet(type) {
  state.inputMode = type;
  state.selectedCategory = type === "income" ? "급여" : "식비";
  const categories = type === "income" ? incomeCategories : expenseCategories;
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
            ${categories.map((name) => `<button class="chip ${name === state.selectedCategory ? "active" : ""}" type="button" data-pick-category="${name}">${name}</button>`).join("")}
          </div>
        </div>
        <details class="advanced-fields">
          <summary>메모·날짜</summary>
          <div class="field">
            <label for="title">메모</label>
            <input id="title" name="title" placeholder="${type === "income" ? "예: 부수입" : "예: 점심"}" />
          </div>
          <div class="field">
            <label for="date">날짜</label>
            <input id="date" name="date" type="date" value="${localDateString(new Date())}" />
          </div>
        </details>
        <button class="primary-button" type="submit">${type === "income" ? "수입 저장" : "지출 저장"}</button>
      </form>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);
  modal.querySelector("#amount")?.focus();

  modal.querySelectorAll("[data-pick-category]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedCategory = button.dataset.pickCategory;
      modal.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("active"));
      button.classList.add("active");
    });
  });

  modal.querySelector("[data-transaction-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = numberFromInput(form.get("amount"));
    if (!amount) return;
    const before = getMetrics(state);
    const transaction = {
      id: cryptoId(),
      type,
      amount,
      category: state.selectedCategory,
      title: String(form.get("title") || state.selectedCategory),
      date: String(form.get("date") || localDateString(new Date())),
      source: "manual",
    };
    const next = { ...state, transactions: [...state.transactions, transaction] };
    const after = getMetrics(next);
    const dayShift = arrivalDayShift(before.arrivalDate, after.arrivalDate);
    state = {
      ...next,
      toast:
        type === "income"
          ? `이번달 수입 +${money(amount)}. 1억 예상 도착 ${dayShift}.`
          : `이번달 지출 +${money(amount)}. 저장했습니다.`,
    };
    saveState();
    modal.remove();
    render();
    clearToastSoon();
  });
}

function createFixedItem(type, name, amount, day, category, date = new Date()) {
  return {
    id: cryptoId(),
    type,
    name,
    amount,
    day,
    category,
    active: true,
    startMonth: monthKey(date),
  };
}

function openFixedSheet() {
  const templates = [
    { label: "월급", type: "income", category: "급여", day: 25 },
    { label: "월세", type: "expense", category: "고정비", day: 1 },
    { label: "통신비", type: "expense", category: "고정비", day: 15 },
    { label: "보험", type: "expense", category: "보험", day: 20 },
    { label: "구독", type: "expense", category: "구독", day: 7 },
  ];
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">고정 항목 추가</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <form class="form-grid" data-fixed-form>
        <div class="field">
          <label>자주 쓰는 항목</label>
          <div class="chips">
            ${templates.map((item) => `<button class="chip" type="button" data-fixed-template="${item.label}" data-fixed-type="${item.type}" data-fixed-category="${item.category}" data-fixed-day="${item.day}">${item.label}</button>`).join("")}
          </div>
        </div>
        <div class="field">
          <label for="fixedName">이름</label>
          <input id="fixedName" name="name" placeholder="예: 월급, 월세, 통신비" autofocus />
        </div>
        <div class="two-col">
          <div class="field">
            <label for="fixedType">종류</label>
            <select id="fixedType" name="type">
              <option value="expense">지출</option>
              <option value="income">수입</option>
            </select>
          </div>
          <div class="field">
            <label for="fixedDay">매월</label>
            <select id="fixedDay" name="day">
              ${Array.from({ length: 31 }, (_, index) => `<option value="${index + 1}">${index + 1}일</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="fixedAmount">금액</label>
          <input id="fixedAmount" name="amount" inputmode="numeric" placeholder="예: 500000" />
        </div>
        <div class="field">
          <label for="fixedCategory">카테고리</label>
          <input id="fixedCategory" name="category" placeholder="예: 고정비" value="고정비" />
        </div>
        <button class="primary-button" type="submit">고정 항목 저장</button>
      </form>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);
  modal.querySelectorAll("[data-fixed-template]").forEach((button) => {
    button.addEventListener("click", () => {
      modal.querySelector("#fixedName").value = button.dataset.fixedTemplate;
      modal.querySelector("#fixedType").value = button.dataset.fixedType;
      modal.querySelector("#fixedDay").value = button.dataset.fixedDay;
      modal.querySelector("#fixedCategory").value = button.dataset.fixedCategory;
      modal.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("active"));
      button.classList.add("active");
      modal.querySelector("#fixedAmount")?.focus();
    });
  });
  modal.querySelector("[data-fixed-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = numberFromInput(form.get("amount"));
    const name = String(form.get("name") || "").trim();
    if (!amount || !name) return;
    const item = createFixedItem(
      String(form.get("type")),
      name,
      amount,
      Number(form.get("day")),
      String(form.get("category") || "기타").trim(),
      new Date(),
    );
    const next = applyFixedItems({
      ...state,
      fixedItems: [...state.fixedItems, item],
      toast: "고정 항목을 저장했습니다.",
    }).state;
    state = next;
    saveState();
    modal.remove();
    render();
    clearToastSoon();
  });
}

function openVariableAssetSheet() {
  const currentAmount = Number(state.variableAsset?.amount || state.settings.startVariableAsset || 0);
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.innerHTML = `
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-header">
        <h2 class="sheet-title">변동자산 업데이트</h2>
        <button class="ghost-button" data-close-sheet>닫기</button>
      </div>
      <form class="form-grid" data-variable-form>
        <div class="upload-zone">
          <input id="assetCapture" name="capture" type="file" accept="image/*" />
          <label for="assetCapture">MTS·코인 자산 화면 캡쳐 선택</label>
          <p>가능하면 총 평가금액이 보이는 화면을 올려주세요.</p>
        </div>
        <img class="preview-image" alt="선택한 캡쳐 미리보기" data-preview hidden />
        <div class="ocr-note" data-ocr-status>캡쳐를 선택하면 금액 후보를 찾아봅니다.</div>
        <div class="field">
          <label for="variableAmount">확인한 평가금액</label>
          <input id="variableAmount" name="amount" inputmode="numeric" value="${currentAmount}" />
        </div>
        <button class="primary-button" type="submit">변동자산 반영</button>
      </form>
    </section>
  `;
  document.body.appendChild(modal);
  bindSheetClose(modal);

  let selectedImageName = "";
  const fileInput = modal.querySelector("#assetCapture");
  const preview = modal.querySelector("[data-preview]");
  const status = modal.querySelector("[data-ocr-status]");
  const amountInput = modal.querySelector("#variableAmount");

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    selectedImageName = file.name;
    const imageUrl = URL.createObjectURL(file);
    preview.src = imageUrl;
    preview.hidden = false;
    status.textContent = "캡쳐에서 금액 후보를 찾는 중입니다.";
    preview.onload = async () => {
      const detected = await detectAmountFromImage(preview);
      if (detected) {
        amountInput.value = detected;
        status.textContent = `금액 후보 ${money(detected)}를 찾았습니다. 맞는지 확인해 주세요.`;
      } else {
        status.textContent = "자동 인식이 어렵습니다. 평가금액을 직접 확인해 주세요.";
      }
      URL.revokeObjectURL(imageUrl);
    };
  });

  modal.querySelector("[data-variable-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amount = numberFromInput(form.get("amount"));
    if (!amount) return;
    const previousAmount = Number(state.variableAsset?.amount || 0);
    const delta = amount - previousAmount;
    const historyItem = {
      id: cryptoId(),
      date: localDateString(new Date()),
      amount,
      delta,
      imageName: selectedImageName,
      source: "screenshot",
    };
    state = {
      ...state,
      variableAsset: {
        amount,
        updatedAt: localDateString(new Date()),
        source: "screenshot",
        imageName: selectedImageName,
        history: [historyItem, ...(state.variableAsset?.history || [])],
      },
      toast: `변동자산 ${money(amount)} 반영. 이전보다 ${signedMoney(delta)}.`,
    };
    saveState();
    modal.remove();
    render();
    clearToastSoon();
  });
}

function exportData() {
  const { toast, ...persisted } = state;
  const payload = {
    app: "1억 모으기",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: persisted,
  };
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
    const imported = parsed.data || parsed;
    state = applyFixedItems({
      ...defaultState(),
      ...imported,
      settings: { ...defaultState().settings, ...imported.settings },
      variableAsset: { ...defaultState().variableAsset, ...imported.variableAsset },
      transactions: imported.transactions || [],
      fixedItems: imported.fixedItems || [],
      hasOnboarded: true,
      toast: "백업 데이터를 복원했습니다.",
    }).state;
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

function bindSheetClose(modal) {
  modal.querySelector("[data-close-sheet]").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.remove();
  });
}

function getMetrics(currentState) {
  const today = new Date();
  const currentMonth = monthKey(today);
  const transactions = currentState.transactions || [];
  const settings = currentState.settings;
  const variableAssetAmount = Number(currentState.variableAsset?.amount || settings.startVariableAsset || 0);
  const variableAssetDelta = variableAssetAmount - Number(settings.startVariableAsset || 0);
  const currentNetWorth =
    Number(settings.startNetWorth || 0) +
    sumTransactions(transactions, "income") -
    sumTransactions(transactions, "expense") +
    variableAssetDelta;
  const remaining = Math.max(0, Number(settings.targetAmount || 0) - currentNetWorth);
  const progress = Math.max(0, Math.min(100, (currentNetWorth / Number(settings.targetAmount || 1)) * 100));
  const monthTransactions = transactions.filter((item) => monthKey(parseDate(item.date)) === currentMonth);
  const monthIncome = sumTransactions(monthTransactions, "income");
  const monthExpense = sumTransactions(monthTransactions, "expense");
  const monthSaving = monthIncome - monthExpense;
  const projected = getProjectedMonth(currentState, today);
  const speed = getSavingSpeed(currentState, today);
  const projectedMonthlySaving = speed.monthlySaving;
  const monthsToTargetDate = Math.max(1, monthsBetween(today, parseDate(settings.targetDate)));
  const neededMonthlySaving = remaining / monthsToTargetDate;
  const monthlyGap = projectedMonthlySaving - neededMonthlySaving;
  const arrivalDate = projectedMonthlySaving > 0 ? addMonths(today, Math.ceil(remaining / projectedMonthlySaving)) : null;
  const arrivalGapText = getArrivalGapText(arrivalDate, parseDate(settings.targetDate), monthlyGap);
  const savingRate = monthIncome > 0 ? (monthSaving / monthIncome) * 100 : 0;
  const categoryExpenses = monthTransactions
    .filter((item) => item.type === "expense")
    .reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + Number(item.amount || 0);
      return acc;
    }, {});
  const fixedExpense = projected.fixedExpense;
  const fixedExpenseRate = projected.income > 0 ? (fixedExpense / projected.income) * 100 : 0;
  const nextFixed = getNextFixed(currentState.fixedItems, today);
  const variableUpdatedAt = parseDate(currentState.variableAsset?.updatedAt || settings.startDate);
  const variableAssetAgeText = `${daysBetween(variableUpdatedAt, today)}일 전 업데이트`;

  return {
    currentNetWorth,
    remaining,
    progress,
    monthIncome,
    monthExpense,
    monthSaving,
    projectedMonthlySaving,
    neededMonthlySaving,
    monthlyGap,
    arrivalDate,
    arrivalGapText,
    savingRate,
    categoryExpenses,
    fixedExpenseRate,
    nextFixed,
    variableAssetAmount,
    variableAssetDelta,
    variableAssetAgeText,
    speedBasisLabel: speed.basisLabel,
    speedMonthlySaving: speed.monthlySaving,
    speedMonths: speed.monthlySavings,
  };
}

function getProjectedMonth(currentState, today) {
  const currentMonth = monthKey(today);
  const monthTransactions = currentState.transactions.filter((item) => monthKey(parseDate(item.date)) === currentMonth);
  let income = sumTransactions(monthTransactions, "income");
  let expense = sumTransactions(monthTransactions, "expense");
  let fixedExpense = monthTransactions
    .filter((item) => item.type === "expense" && item.source === "fixed")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  currentState.fixedItems
    .filter((item) => item.active)
    .forEach((item) => {
      const id = fixedTransactionId(item, currentMonth);
      const alreadyRecorded = currentState.transactions.some((tx) => tx.id === id);
      if (alreadyRecorded) return;
      if (monthComesBefore(currentMonth, item.startMonth)) return;
      if (item.type === "income") income += Number(item.amount || 0);
      if (item.type === "expense") {
        expense += Number(item.amount || 0);
        fixedExpense += Number(item.amount || 0);
      }
    });

  return { income, expense, fixedExpense };
}

function getSavingSpeed(currentState, today) {
  const completedMonths = getCompletedMonthKeys(today, 3);
  const monthlySavings = completedMonths.map((month) => {
    const monthTransactions = currentState.transactions.filter((item) => monthKey(parseDate(item.date)) === month);
    return {
      month,
      count: monthTransactions.length,
      saving: sumTransactions(monthTransactions, "income") - sumTransactions(monthTransactions, "expense"),
    };
  });
  const hasThreeMonths = monthlySavings.every((item) => item.count > 0);

  if (hasThreeMonths) {
    const average =
      monthlySavings.reduce((sum, item) => sum + item.saving, 0) / monthlySavings.length;
    return {
      monthlySaving: average,
      basisLabel: "최근 3개월 평균 기준",
      monthlySavings,
    };
  }

  const monthlyGoal = Number(currentState.settings.monthlySavingGoal || 0);
  if (monthlyGoal > 0) {
    return {
      monthlySaving: monthlyGoal,
      basisLabel: `월 목표 ${readableMoney(monthlyGoal)} 기준`,
      monthlySavings,
    };
  }

  return {
    monthlySaving: 0,
    basisLabel: "월 목표 저축액을 설정해 주세요",
    monthlySavings,
  };
}

function applyFixedItems(currentState) {
  const today = new Date();
  const existingIds = new Set(currentState.transactions.map((item) => item.id));
  const nextTransactions = [...currentState.transactions];
  let added = 0;

  currentState.fixedItems
    .filter((item) => item.active)
    .forEach((item) => {
      const start = item.startMonth || monthKey(parseDate(currentState.settings.startDate));
      getMonthRange(start, monthKey(today)).forEach((month) => {
        if (monthComesBefore(month, start)) return;
        const dueDate = dueDateForMonth(month, item.day);
        if (dueDate > today) return;
        const id = fixedTransactionId(item, month);
        if (existingIds.has(id)) return;
        nextTransactions.push({
          id,
          type: item.type,
          amount: Number(item.amount || 0),
          category: item.category,
          title: item.name,
          date: localDateString(dueDate),
          source: "fixed",
          fixedItemId: item.id,
        });
        existingIds.add(id);
        added += 1;
      });
    });

  return {
    state: {
      ...currentState,
      transactions: nextTransactions,
      toast: added > 0 ? `자동 기록 ${added}건이 반영됐습니다.` : currentState.toast,
    },
    added,
  };
}

function getNextFixed(fixedItems, today) {
  const active = fixedItems.filter((item) => item.active);
  if (!active.length) return null;
  const candidates = [];
  for (let offset = 0; offset < 3; offset += 1) {
    const base = addMonths(today, offset);
    const month = monthKey(base);
    active.forEach((item) => {
      const dueDate = dueDateForMonth(month, item.day);
      if (dueDate >= startOfDay(today)) {
        candidates.push({
          ...item,
          dueDate,
          daysLeft: Math.ceil((startOfDay(dueDate) - startOfDay(today)) / 86400000),
        });
      }
    });
  }
  return candidates.sort((a, b) => a.dueDate - b.dueDate)[0] || null;
}

function getMonthRange(startMonth, endMonth) {
  const [startYear, startM] = startMonth.split("-").map(Number);
  const [endYear, endM] = endMonth.split("-").map(Number);
  const months = [];
  let year = startYear;
  let month = startM;
  while (year < endYear || (year === endYear && month <= endM)) {
    months.push(`${year}-${pad(month)}`);
    month += 1;
    if (month > 12) {
      year += 1;
      month = 1;
    }
  }
  return months;
}

function getArrivalGapText(arrivalDate, targetDate, monthlyGap) {
  if (!arrivalDate) return "현재 저축 속도로는 1억 도착일을 계산할 수 없습니다.";
  const diff = monthsBetween(targetDate, arrivalDate);
  if (diff <= 0) return "현재 속도면 목표일 안에 1억에 도착합니다.";
  const years = Math.floor(diff / 12);
  const months = diff % 12;
  const delay = [years ? `${years}년` : "", months ? `${months}개월` : ""].filter(Boolean).join(" ");
  if (monthlyGap < 0) return `지금 속도면 목표보다 ${delay} 늦습니다.`;
  return "현재 속도면 목표보다 빠르게 도착합니다.";
}

function moneyRow(label, value) {
  return `
    <div class="money-row">
      <span>${label}</span>
      <strong>${typeof value === "number" ? money(value) : value}</strong>
    </div>
  `;
}

function barRow(label, value, max, type) {
  const width = Math.min(100, (Math.abs(value) / max) * 100);
  return `
    <div class="bar-row">
      <div class="bar-label">${label}</div>
      <div class="bar-track">
        <div class="bar-fill ${type}" style="width:${width}%"></div>
      </div>
      <div class="bar-value">${money(value)}</div>
    </div>
  `;
}

async function detectAmountFromImage(imageElement) {
  if (!window.TextDetector) return null;
  try {
    const detector = new window.TextDetector();
    const results = await detector.detect(imageElement);
    const text = results.map((result) => result.rawValue || "").join(" ");
    return extractAmountCandidate(text);
  } catch {
    return null;
  }
}

function extractAmountCandidate(text) {
  const candidates = String(text)
    .match(/\d[\d,.\s]{3,}\d/g)
    ?.map((value) => numberFromInput(value))
    .filter((value) => value >= 10000 && value <= 10000000000);
  if (!candidates?.length) return null;
  return Math.max(...candidates);
}

function sumTransactions(transactions, type) {
  return transactions
    .filter((item) => item.type === type)
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
}

function money(value) {
  const number = Math.round(Number(value || 0));
  return `${number.toLocaleString("ko-KR")}원`;
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

function getCompletedMonthKeys(today, count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - index - 1, 1);
    return monthKey(date);
  }).reverse();
}

function dueDateForMonth(month, day) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  return new Date(year, monthNumber - 1, Math.min(day, days));
}

function fixedTransactionId(item, month) {
  return `fixed-${item.id}-${month}`;
}

function monthComesBefore(a, b) {
  return a < b;
}

function monthsBetween(fromDate, toDate) {
  const from = parseDate(localDateString(fromDate));
  const to = parseDate(localDateString(toDate));
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  return Math.max(0, months + (to.getDate() >= from.getDate() ? 0 : -1));
}

function daysBetween(fromDate, toDate) {
  return Math.max(0, Math.floor((startOfDay(toDate) - startOfDay(fromDate)) / 86400000));
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

function formatDate(date) {
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatMonthKey(value) {
  const [year, month] = String(value).split("-");
  return `${Number(month)}월`;
}

function formatYearMonth(date) {
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

function sortByDateDesc(a, b) {
  return parseDate(b.date) - parseDate(a.date);
}

function arrivalDayShift(before, after) {
  if (!before && !after) return "계산 불가";
  if (!before && after) return "계산 시작";
  if (before && !after) return "계산 불가";
  const days = Math.round((after - before) / 86400000);
  if (days === 0) return "변화 없음";
  return days > 0 ? `${days}일 늦어짐` : `${Math.abs(days)}일 앞당김`;
}

function cryptoId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clearToastSoon() {
  window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2400);
}
