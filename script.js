/* ==========================================================================
   DAYBOOK — Expense, Budget & Savings Tracker
   Plain vanilla JavaScript. No frameworks, no build step.

   How the numbers work (read this first):
   -----------------------------------------------------------------------
   A plan's daily limit is fixed when the plan is saved:
       daily limit = total budget / total number of days
   At the end of each day, the difference between that day's limit and
   actual spending is added to or taken from Savings. Today is not counted
   until it has ended, so new plans always start with ৳0.00 savings.
   See computeStats() below for the exact step-by-step implementation.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 1. CONSTANTS
   * ------------------------------------------------------------------ */


  /* ------------------------------------------------------------------ *
   * 2. DOM REFERENCES
   * ------------------------------------------------------------------ */

  var el = {
    // Local account gate
    authSection: document.getElementById('authSection'),
    appShell: document.getElementById('appShell'),
    loginTab: document.getElementById('loginTab'),
    registerTab: document.getElementById('registerTab'),
    loginForm: document.getElementById('loginForm'),
    registerForm: document.getElementById('registerForm'),
    loginEmail: document.getElementById('loginEmail'),
    loginPassword: document.getElementById('loginPassword'),
    loginError: document.getElementById('loginError'),
    registerName: document.getElementById('registerName'),
    registerEmail: document.getElementById('registerEmail'),
    registerPassword: document.getElementById('registerPassword'),
    registerError: document.getElementById('registerError'),
    profileName: document.getElementById('profileName'),
    logoutBtn: document.getElementById('logoutBtn'),
    // Setup
    setupSection: document.getElementById('setupSection'),
    setupForm: document.getElementById('setupForm'),
    startDateInput: document.getElementById('startDateInput'),
    endDateInput: document.getElementById('endDateInput'),
    budgetInput: document.getElementById('budgetInput'),
    startDateError: document.getElementById('startDateError'),
    endDateError: document.getElementById('endDateError'),
    budgetError: document.getElementById('budgetError'),
    setupSummary: document.getElementById('setupSummary'),
    editPlanBtn: document.getElementById('editPlanBtn'),

    // Warning
    warningBanner: document.getElementById('warningBanner'),

    // Stats
    statsGrid: document.getElementById('statsGrid'),
    statTotalBudget: document.getElementById('statTotalBudget'),
    statTotalSpent: document.getElementById('statTotalSpent'),
    statRemaining: document.getElementById('statRemaining'),
    statDailyLimit: document.getElementById('statDailyLimit'),
    statDailyLimitHelper: document.getElementById('statDailyLimitHelper'),
    statSavings: document.getElementById('statSavings'),
    statTotalEarned: document.getElementById('statTotalEarned'),

    // Progress
    progressSection: document.getElementById('progressSection'),
    budgetProgressFill: document.getElementById('budgetProgressFill'),
    budgetProgressText: document.getElementById('budgetProgressText'),
    savingsProgressFill: document.getElementById('savingsProgressFill'),
    savingsProgressText: document.getElementById('savingsProgressText'),

    // Expense form
    expenseFormSection: document.getElementById('expenseFormSection'),
    expenseForm: document.getElementById('expenseForm'),
    expenseFormNote: document.getElementById('expenseFormNote'),
    expenseDateInput: document.getElementById('expenseDateInput'),
    expenseNameInput: document.getElementById('expenseNameInput'),
    expensePriceInput: document.getElementById('expensePriceInput'),
    expenseDateError: document.getElementById('expenseDateError'),
    expenseNameError: document.getElementById('expenseNameError'),
    expensePriceError: document.getElementById('expensePriceError'),

    // Earning form and history
    earningFormSection: document.getElementById('earningFormSection'),
    earningForm: document.getElementById('earningForm'),
    earningDateInput: document.getElementById('earningDateInput'),
    earningNameInput: document.getElementById('earningNameInput'),
    earningAmountInput: document.getElementById('earningAmountInput'),
    earningDateError: document.getElementById('earningDateError'),
    earningNameError: document.getElementById('earningNameError'),
    earningAmountError: document.getElementById('earningAmountError'),
    earningsSection: document.getElementById('earningsSection'),
    earningsList: document.getElementById('earningsList'),
    earningsEmptyState: document.getElementById('earningsEmptyState'),

    // History
    historySection: document.getElementById('historySection'),
    historyList: document.getElementById('historyList'),
    historyEmptyState: document.getElementById('historyEmptyState'),
    filterEmptyState: document.getElementById('filterEmptyState'),
    filterDateSelect: document.getElementById('filterDateSelect'),
    clearFilterBtn: document.getElementById('clearFilterBtn'),

    // Footer / reset
    resetBtn: document.getElementById('resetBtn'),

    // Modals: reset
    confirmModalOverlay: document.getElementById('confirmModalOverlay'),
    confirmCancelBtn: document.getElementById('confirmCancelBtn'),
    confirmResetBtn: document.getElementById('confirmResetBtn'),

    // Modals: delete
    deleteModalOverlay: document.getElementById('deleteModalOverlay'),
    deleteModalMessage: document.getElementById('deleteModalMessage'),
    deleteCancelBtn: document.getElementById('deleteCancelBtn'),
    deleteConfirmBtn: document.getElementById('deleteConfirmBtn'),

    // Modals: edit
    editModalOverlay: document.getElementById('editModalOverlay'),
    editExpenseForm: document.getElementById('editExpenseForm'),
    editExpenseId: document.getElementById('editExpenseId'),
    editDateInput: document.getElementById('editDateInput'),
    editNameInput: document.getElementById('editNameInput'),
    editPriceInput: document.getElementById('editPriceInput'),
    editDateError: document.getElementById('editDateError'),
    editNameError: document.getElementById('editNameError'),
    editPriceError: document.getElementById('editPriceError'),
    editCancelBtn: document.getElementById('editCancelBtn'),

    liveRegion: document.getElementById('liveRegion')
  };

  /* ------------------------------------------------------------------ *
   * 3. APPLICATION STATE
   * ------------------------------------------------------------------ */

  // The authenticated user's data is loaded from the FastAPI/PostgreSQL server.
  var activeUserId = '';
  var currentUser = null;
  var state = getDefaultState();

  // Transient, non-persisted UI state
  var ui = {
    showSetupForm: false, // forced true below if there's no plan yet
    filterDate: '',        // '' = show every date
    lastAddedExpenseId: null,
    pendingDeleteId: null,
    editingExpenseId: null  // track which expense is being edited
  };

  var lastKnownToday = todayStr();

  function getDefaultState() {
    return { startDate: null, endDate: null, totalBudget: null, expenses: [], earnings: [] };
  }

  function getActiveAccount() {
    return currentUser;
  }

  function normalizeState(parsed) {
    try {
      if (!parsed || typeof parsed !== 'object') return getDefaultState();
      // Defensive shape-check so corrupted/edited storage can't crash the app
      return {
        startDate: typeof parsed.startDate === 'string' ? parsed.startDate : null,
        endDate: typeof parsed.endDate === 'string' ? parsed.endDate : null,
        totalBudget: typeof parsed.totalBudget === 'number' && isFinite(parsed.totalBudget) ? parsed.totalBudget : null,
        expenses: Array.isArray(parsed.expenses) ? parsed.expenses.filter(isValidExpenseShape) : [],
        earnings: Array.isArray(parsed.earnings) ? parsed.earnings.filter(isValidEarningShape) : []
      };
    } catch (err) {
      console.warn('Daybook: server data was unreadable, starting fresh.', err);
      return getDefaultState();
    }
  }

  function isValidExpenseShape(e) {
    return e && typeof e.id === 'string' && typeof e.date === 'string' &&
           typeof e.name === 'string' && typeof e.price === 'number' && isFinite(e.price);
  }

  function isValidEarningShape(e) {
    return e && typeof e.id === 'string' && typeof e.date === 'string' &&
      typeof e.name === 'string' && typeof e.amount === 'number' && isFinite(e.amount);
  }

  function saveState() {
    if (!activeUserId) return;
    fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(state)
    }).then(function (response) {
      if (!response.ok) throw new Error('Could not save data');
    }).catch(function (err) {
      console.warn('Daybook: could not save data to the server.', err);
      announce('Your latest change could not be saved. Please check your connection.');
    });
  }

  function hasPlan() {
    return !!(state.startDate && state.endDate && typeof state.totalBudget === 'number');
  }


  /* ------------------------------------------------------------------ *
   * 4. DATE HELPERS
   * All dates are plain 'YYYY-MM-DD' strings, which sort and compare
   * correctly with normal string comparisons (===, <, >).
   * ------------------------------------------------------------------ */

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatDateLocal(dateObj) {
    return dateObj.getFullYear() + '-' + pad2(dateObj.getMonth() + 1) + '-' + pad2(dateObj.getDate());
  }

  function todayStr() {
    return formatDateLocal(new Date());
  }

  // Parsing 'YYYY-MM-DD' with an explicit time avoids UTC/local timezone
  // shifting the date by a day, which plain `new Date('YYYY-MM-DD')` can do.
  function parseLocalDate(dateStr) {
    return new Date(dateStr + 'T00:00:00');
  }

  function addDaysStr(dateStr, days) {
    var d = parseLocalDate(dateStr);
    d.setDate(d.getDate() + days);
    return formatDateLocal(d);
  }

  // Every date string from start to end, inclusive, in chronological order.
  function getDateRangeArray(startStr, endStr) {
    var dates = [];
    var cursor = startStr;
    var safety = 0;
    while (cursor <= endStr && safety < 10000) {
      dates.push(cursor);
      cursor = addDaysStr(cursor, 1);
      safety++;
    }
    return dates;
  }

  function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    return parseLocalDate(dateStr).toLocaleDateString('en-GB', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  function formatDisplayDateShort(dateStr) {
    if (!dateStr) return '';
    return parseLocalDate(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'short'
    });
  }

  /* ------------------------------------------------------------------ *
   * 5. FORMATTING HELPERS
   * ------------------------------------------------------------------ */

  function formatMoney(amount) {
    var safe = isFinite(amount) ? amount : 0;
    var sign = safe < 0 ? '\u2212' : ''; // proper minus sign, placed before the currency symbol
    return sign + '\u09F3' + Math.abs(safe).toFixed(2); // ৳ Bangladeshi Taka sign
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  /* ------------------------------------------------------------------ *
   * 6. STATS COMPUTATION — the heart of the app
   * ------------------------------------------------------------------ */

  function computeStats() {
    var stats = {
      totalBudget: state.totalBudget || 0,
       totalSpent: 0,
       totalEarned: 0,
      remainingBudget: state.totalBudget || 0,
      dailyLimit: 0,
      savings: 0,
      remainingDays: 0,
      totalDays: 0,
       dailyLimitsByDate: {}, // date -> the plan's fixed daily limit
      daySpendByDate: {},    // date -> total spent that day
      periodStatus: 'no-plan' // 'no-plan' | 'not-started' | 'active' | 'ended'
    };

    if (!hasPlan()) return stats;

    var today = todayStr();
    var allDates = getDateRangeArray(state.startDate, state.endDate);
    stats.totalDays = allDates.length;

    // Tally what was actually spent on each date.
    state.expenses.forEach(function (exp) {
      stats.daySpendByDate[exp.date] = (stats.daySpendByDate[exp.date] || 0) + exp.price;
    });
    stats.totalSpent = state.expenses.reduce(function (sum, e) { return sum + e.price; }, 0);
    stats.totalEarned = state.earnings.reduce(function (sum, e) { return sum + e.amount; }, 0);
    stats.remainingBudget = state.totalBudget - stats.totalSpent;

    var fixedDailyLimit = state.totalBudget / stats.totalDays;
    allDates.forEach(function (day) { stats.dailyLimitsByDate[day] = fixedDailyLimit; });

    // Savings only changes after a day is complete. This prevents today's unused
    // allowance from appearing as savings before the day has actually ended.
    allDates.forEach(function (day) {
      if (day < today) stats.savings += fixedDailyLimit - (stats.daySpendByDate[day] || 0);
    });

    if (today < state.startDate) {
      stats.periodStatus = 'not-started';
      stats.dailyLimit = fixedDailyLimit;
      stats.remainingDays = stats.totalDays;
    } else if (today > state.endDate) {
      stats.periodStatus = 'ended';
      stats.dailyLimit = 0;
      stats.remainingDays = 0;
    } else {
      stats.periodStatus = 'active';
      stats.dailyLimit = fixedDailyLimit;
      stats.remainingDays = stats.totalDays - allDates.indexOf(today);
    }

    return stats;
  }

  /* ------------------------------------------------------------------ *
   * 7. VALIDATION
   * ------------------------------------------------------------------ */

  function validateSetupForm(startVal, endVal, budgetVal) {
    var errors = {};

    if (!startVal) errors.start = 'Pick a start date.';
    if (!endVal) errors.end = 'Pick an end date.';
    if (startVal && endVal && endVal < startVal) {
      errors.end = 'End date must be on or after the start date.';
    }

    var budgetNum = parseFloat(budgetVal);
    if (budgetVal === '' || budgetVal === null || isNaN(budgetNum)) {
      errors.budget = 'Enter a budget amount.';
    } else if (budgetNum <= 0) {
      errors.budget = 'Budget must be greater than zero.';
    }

    return { valid: Object.keys(errors).length === 0, errors: errors, budgetNum: budgetNum };
  }

  function validateExpenseForm(dateVal, nameVal, priceVal, isEdit) {
    var errors = {};
    var minDate = state.startDate;
    // For editing, allow the full plan date range (up to endDate)
    // so users can edit expenses on past dates even if today > endDate.
    // For adding new expenses, restrict to today or endDate (whichever is earlier).
    var maxDate;
    if (isEdit) {
      maxDate = state.endDate;
    } else {
      maxDate = todayStr() < state.endDate ? todayStr() : state.endDate;
    }

    if (!dateVal) {
      errors.date = 'Pick a date.';
    } else if (dateVal < minDate || dateVal > maxDate) {
      errors.date = 'Pick a date between ' + formatDisplayDateShort(minDate) + ' and ' + formatDisplayDateShort(maxDate) + '.';
    }

    var trimmedName = (nameVal || '').trim();
    if (!trimmedName) {
      errors.name = 'Say what you spent on.';
    } else if (trimmedName.length > 60) {
      errors.name = 'Keep it under 60 characters.';
    }

    var priceNum = parseFloat(priceVal);
    if (priceVal === '' || priceVal === null || isNaN(priceNum)) {
      errors.price = 'Enter a price.';
    } else if (priceNum <= 0) {
      errors.price = 'Price must be greater than zero.';
    }

    return { valid: Object.keys(errors).length === 0, errors: errors, priceNum: priceNum, trimmedName: trimmedName };
  }

  function validateEarningForm(dateVal, nameVal, amountVal) {
    var errors = {};
    var trimmedName = (nameVal || '').trim();
    if (!dateVal) errors.date = 'Pick a date.';
    if (!trimmedName) errors.name = 'Enter the work name.';
    else if (trimmedName.length > 60) errors.name = 'Keep it under 60 characters.';
    var amountNum = parseFloat(amountVal);
    if (amountVal === '' || amountVal === null || isNaN(amountNum)) errors.amount = 'Enter an earning amount.';
    else if (amountNum <= 0) errors.amount = 'Amount must be greater than zero.';
    return { valid: Object.keys(errors).length === 0, errors: errors, amountNum: amountNum, trimmedName: trimmedName };
  }

  function showFieldError(inputEl, errorEl, message) {
    if (!inputEl || !errorEl) return;
    errorEl.textContent = message || '';
    inputEl.classList.toggle('has-error', !!message);
  }

  function clearFieldErrors(pairs) {
    pairs.forEach(function (pair) { showFieldError(pair[0], pair[1], ''); });
  }

  /* ------------------------------------------------------------------ *
   * 8. RENDERING
   * Every render function reads from `state`/`ui` and writes to the DOM.
   * Nothing here mutates application state — that only happens in the
   * event handlers, which then call renderAll().
   * ------------------------------------------------------------------ */

  function renderAll() {
    var stats = computeStats();

    renderSetup(stats);
    renderSectionVisibility();
    renderWarning(stats);
    renderStats(stats);
    renderProgress(stats);
    renderExpenseForm(stats);
    renderEarningForm();
    renderEarningsHistory();
    renderHistory(stats);
  }

  function renderSectionVisibility() {
    var show = hasPlan();
    el.statsGrid.hidden = !show;
    el.progressSection.hidden = !show;
    el.expenseFormSection.hidden = !show;
    el.earningFormSection.hidden = !show;
    el.earningsSection.hidden = !show;
    el.historySection.hidden = !show;
  }

  function renderSetup() {
    var showForm = ui.showSetupForm || !hasPlan();

    el.setupForm.hidden = !showForm;
    el.setupSummary.hidden = showForm || !hasPlan();
    el.editPlanBtn.hidden = showForm || !hasPlan();

    if (hasPlan()) {
      // Keep the form pre-filled in case the user reopens it to edit.
      el.startDateInput.value = state.startDate;
      el.endDateInput.value = state.endDate;
      el.budgetInput.value = state.totalBudget;
      el.endDateInput.min = state.startDate;
      el.startDateInput.max = state.endDate;

      var days = getDateRangeArray(state.startDate, state.endDate).length;
      el.setupSummary.textContent = 'Tracking ' + formatMoney(state.totalBudget) + ' from ' +
        formatDisplayDate(state.startDate) + ' to ' + formatDisplayDate(state.endDate) +
        ' (' + days + ' day' + (days === 1 ? '' : 's') + ').';
    }
  }

  function renderWarning(stats) {
    if (!hasPlan()) {
      el.warningBanner.hidden = true;
      return;
    }

    if (stats.periodStatus === 'active') {
      var today = todayStr();
      var spentToday = stats.daySpendByDate[today] || 0;
      var limitToday = stats.dailyLimit;

      if (spentToday > limitToday) {
        var over = spentToday - limitToday;
        el.warningBanner.className = 'warning-banner';
        el.warningBanner.innerHTML = '<span><strong>Over today\u2019s limit.</strong> You\u2019ve spent ' +
          formatMoney(spentToday) + ' today, ' + formatMoney(over) + ' more than your ' +
          formatMoney(limitToday) + ' limit. The extra has been taken out of savings.</span>';
        el.warningBanner.hidden = false;
        return;
      }
    } else if (stats.periodStatus === 'ended') {
      el.warningBanner.className = 'warning-banner is-neutral';
      el.warningBanner.innerHTML = '<span><strong>This budget period has ended.</strong> You can still add expenses for any date up to ' +
        formatDisplayDateShort(state.endDate) + '.</span>';
      el.warningBanner.hidden = false;
      return;
    }

    el.warningBanner.hidden = true;
  }

  function renderStats(stats) {
    el.statTotalBudget.textContent = formatMoney(stats.totalBudget);
    el.statTotalSpent.textContent = formatMoney(stats.totalSpent);

    el.statRemaining.textContent = formatMoney(stats.remainingBudget);
    el.statRemaining.classList.toggle('is-negative', stats.remainingBudget < 0);

    el.statDailyLimit.textContent = formatMoney(stats.dailyLimit);

    if (stats.periodStatus === 'not-started') {
      el.statDailyLimitHelper.textContent = 'Starts ' + formatDisplayDateShort(state.startDate);
    } else if (stats.periodStatus === 'ended') {
      el.statDailyLimitHelper.textContent = 'Period ended';
    } else if (stats.periodStatus === 'active') {
      el.statDailyLimitHelper.textContent = stats.remainingDays + ' day' + (stats.remainingDays === 1 ? '' : 's') + ' left';
    } else {
      el.statDailyLimitHelper.textContent = '';
    }

    var savingsSign = stats.savings >= 0 ? '+' : '\u2212'; // minus sign
    el.statSavings.textContent = savingsSign + formatMoney(Math.abs(stats.savings));
    el.statSavings.classList.toggle('is-positive', stats.savings >= 0);
    el.statSavings.classList.toggle('is-negative', stats.savings < 0);
    el.statTotalEarned.textContent = formatMoney(stats.totalEarned);
  }

  function renderProgress(stats) {
    var budgetPct = stats.totalBudget > 0 ? (stats.totalSpent / stats.totalBudget) * 100 : 0;
    el.budgetProgressFill.style.width = clamp(budgetPct, 0, 100) + '%';
    el.budgetProgressText.textContent = Math.round(budgetPct) + '%';
    el.budgetProgressFill.classList.toggle('is-warning', budgetPct >= 80 && budgetPct < 100);
    el.budgetProgressFill.classList.toggle('is-danger', budgetPct >= 100);

    var savingsPct = stats.totalBudget > 0 ? (stats.savings / stats.totalBudget) * 100 : 0;
    el.savingsProgressFill.style.width = clamp(Math.abs(savingsPct), 0, 100) + '%';
    el.savingsProgressText.textContent = (savingsPct >= 0 ? '+' : '\u2212') + Math.round(Math.abs(savingsPct)) + '%';
    el.savingsProgressFill.classList.toggle('is-negative', savingsPct < 0);
  }

  function renderExpenseForm(stats) {
    if (!hasPlan()) return;

    if (stats.periodStatus === 'not-started') {
      el.expenseForm.hidden = true;
      el.expenseFormNote.hidden = false;
      el.expenseFormNote.textContent = 'Your plan starts on ' + formatDisplayDate(state.startDate) + '. Come back then to log expenses.';
      return;
    }

    el.expenseForm.hidden = false;
    el.expenseFormNote.hidden = true;

    var minDate = state.startDate;
    var maxDate = todayStr() < state.endDate ? todayStr() : state.endDate;

    el.expenseDateInput.min = minDate;
    el.expenseDateInput.max = maxDate;

    // Only set a default value if the field is empty or now out of range —
    // this avoids resetting the user's chosen date after every add.
    if (!el.expenseDateInput.value || el.expenseDateInput.value < minDate || el.expenseDateInput.value > maxDate) {
      el.expenseDateInput.value = maxDate;
    }
  }

  function renderEarningForm() {
    if (!hasPlan()) return;
    if (!el.earningDateInput.value) el.earningDateInput.value = todayStr();
  }

  function renderEarningsHistory() {
    var earnings = state.earnings.slice().sort(function (a, b) {
      return b.date.localeCompare(a.date) || a.name.localeCompare(b.name);
    });
    el.earningsEmptyState.hidden = earnings.length !== 0;
    el.earningsList.innerHTML = '';

    earnings.forEach(function (earning) {
      var row = document.createElement('div');
      row.className = 'expense-row';
      row.innerHTML =
        '<span class="expense-row__name">' + escapeHtml(earning.name) + '</span>' +
        '<span class="earning-date">' + formatDisplayDate(earning.date) + '</span>' +
        '<span class="expense-row__price earning-amount">+' + formatMoney(earning.amount) + '</span>';
      el.earningsList.appendChild(row);
    });
  }

  function renderHistory(stats) {
    // Group expenses by date.
    var byDate = {};
    state.expenses.forEach(function (exp) {
      if (!byDate[exp.date]) byDate[exp.date] = [];
      byDate[exp.date].push(exp);
    });

    var allDatesWithExpenses = Object.keys(byDate).sort().reverse();

    // Keep the "jump to date" dropdown in sync.
    var previousFilterValue = el.filterDateSelect.value;
    el.filterDateSelect.innerHTML = '<option value="">All dates</option>' +
      allDatesWithExpenses.map(function (d) {
        return '<option value="' + d + '">' + formatDisplayDate(d) + '</option>';
      }).join('');
    el.filterDateSelect.value = allDatesWithExpenses.indexOf(previousFilterValue) !== -1 ? previousFilterValue : ui.filterDate;

    el.clearFilterBtn.hidden = !ui.filterDate;

    var datesToRender = ui.filterDate ? allDatesWithExpenses.filter(function (d) { return d === ui.filterDate; }) : allDatesWithExpenses;

    el.historyEmptyState.hidden = state.expenses.length !== 0;
    el.filterEmptyState.hidden = !(ui.filterDate && datesToRender.length === 0);
    el.historyList.innerHTML = '';

    datesToRender.forEach(function (date) {
      var dayExpenses = byDate[date].slice().sort(function (a, b) {
        return a.name.localeCompare(b.name);
      });
      var dayTotal = dayExpenses.reduce(function (sum, e) { return sum + e.price; }, 0);
      var dayLimit = stats.dailyLimitsByDate[date];

      var group = document.createElement('div');
      group.className = 'date-group';

      var head = document.createElement('div');
      head.className = 'date-group__head';

      var badgeHtml = '';
      if (typeof dayLimit === 'number') {
        var diff = dayLimit - dayTotal;
        if (diff >= 0) {
          badgeHtml = '<span class="badge badge--under">Saved ' + formatMoney(diff) + '</span>';
        } else {
          badgeHtml = '<span class="badge badge--over">Over by ' + formatMoney(Math.abs(diff)) + '</span>';
        }
      }

      head.innerHTML =
        '<span class="date-group__date">' + formatDisplayDate(date) + '</span>' +
        '<span class="date-group__totals">' +
          badgeHtml +
          '<span class="date-group__amount">' + formatMoney(dayTotal) + '</span>' +
        '</span>';

      group.appendChild(head);

      dayExpenses.forEach(function (exp) {
        var row = document.createElement('div');
        row.className = 'expense-row' + (exp.id === ui.lastAddedExpenseId ? ' is-new' : '');
        row.dataset.id = exp.id;

        row.innerHTML =
          '<span class="expense-row__name">' + escapeHtml(exp.name) + '</span>' +
          '<span class="expense-row__price">' + formatMoney(exp.price) + '</span>' +
          '<span class="expense-row__actions">' +
            '<button type="button" class="icon-btn edit-btn" data-action="edit" data-id="' + exp.id + '" aria-label="Edit ' + escapeHtml(exp.name) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>' +
            '</button>' +
            '<button type="button" class="icon-btn icon-btn--danger delete-btn" data-action="delete" data-id="' + exp.id + '" aria-label="Delete ' + escapeHtml(exp.name) + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"></path></svg>' +
            '</button>' +
          '</span>';

        group.appendChild(row);
      });

      el.historyList.appendChild(group);
    });

    ui.lastAddedExpenseId = null; // the flash animation only plays once
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ------------------------------------------------------------------ *
   * 9. LOCAL ACCOUNT FLOW
   * ------------------------------------------------------------------ */

  function showAuth(mode) {
    var isLogin = mode === 'login';
    el.loginForm.hidden = !isLogin;
    el.registerForm.hidden = isLogin;
    el.loginTab.classList.toggle('is-active', isLogin);
    el.registerTab.classList.toggle('is-active', !isLogin);
    el.loginTab.setAttribute('aria-selected', String(isLogin));
    el.registerTab.setAttribute('aria-selected', String(!isLogin));
    el.loginError.textContent = '';
    el.registerError.textContent = '';
  }

  function enterApp(account, savedData) {
    activeUserId = account.id;
    currentUser = account;
    state = normalizeState(savedData);
    ui.showSetupForm = !hasPlan();
    el.profileName.textContent = account.name;
    el.authSection.hidden = true;
    el.appShell.hidden = false;
    renderAll();
  }

  function logOut() {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
    activeUserId = '';
    currentUser = null;
    state = getDefaultState();
    ui.filterDate = '';
    el.appShell.hidden = true;
    el.authSection.hidden = false;
    el.loginForm.reset();
    el.registerForm.reset();
    showAuth('login');
  }

  /* ------------------------------------------------------------------ *
   * 10. MODAL HELPERS
   * ------------------------------------------------------------------ */

  function openModal(overlayEl) {
    overlayEl.hidden = false;
    // Prevent body scroll while modal is open
    document.body.style.overflow = 'hidden';
  }

  function closeModal(overlayEl) {
    overlayEl.hidden = true;
    // Check if any other modal is still open before restoring scroll
    if (el.editModalOverlay.hidden && el.deleteModalOverlay.hidden && el.confirmModalOverlay.hidden) {
      document.body.style.overflow = '';
    }
  }

  function announce(message) {
    el.liveRegion.textContent = message;
  }

  /* ------------------------------------------------------------------ *
   * 11. EDIT MODAL — open / populate / save / cancel
   * ------------------------------------------------------------------ */

  function openEditModal(expenseId) {
    var expense = state.expenses.find(function (x) { return x.id === expenseId; });
    if (!expense) return;

    ui.editingExpenseId = expense.id;

    // Populate the edit form fields
    el.editExpenseId.value = expense.id;
    el.editDateInput.value = expense.date;
    el.editNameInput.value = expense.name;
    el.editPriceInput.value = expense.price;

    // Set date range for the edit date input
    el.editDateInput.min = state.startDate;
    el.editDateInput.max = state.endDate;

    // Clear any previous validation errors
    clearFieldErrors([
      [el.editDateInput, el.editDateError],
      [el.editNameInput, el.editNameError],
      [el.editPriceInput, el.editPriceError]
    ]);

    openModal(el.editModalOverlay);

    // Focus the name input after a short delay to ensure modal is visible
    setTimeout(function () {
      el.editNameInput.focus();
    }, 50);
  }

  function saveEditExpense() {
    var dateVal = el.editDateInput.value;
    var nameVal = el.editNameInput.value;
    var priceVal = el.editPriceInput.value;

    var result = validateExpenseForm(dateVal, nameVal, priceVal, true);

    showFieldError(el.editDateInput, el.editDateError, result.errors.date);
    showFieldError(el.editNameInput, el.editNameError, result.errors.name);
    showFieldError(el.editPriceInput, el.editPriceError, result.errors.price);

    if (!result.valid) return;

    var id = el.editExpenseId.value;
    var expense = state.expenses.find(function (x) { return x.id === id; });
    if (!expense) {
      closeEditModal();
      return;
    }

    // Update the expense
    expense.date = dateVal;
    expense.name = result.trimmedName;
    expense.price = result.priceNum;
    saveState();

    closeEditModal();
    announce('Expense updated.');
    renderAll();
  }

  function closeEditModal() {
    ui.editingExpenseId = null;
    closeModal(el.editModalOverlay);
  }

  /* ------------------------------------------------------------------ *
   * 12. DELETE MODAL — open / confirm / cancel
   * ------------------------------------------------------------------ */

  function openDeleteModal(expenseId) {
    var expense = state.expenses.find(function (x) { return x.id === expenseId; });
    if (!expense) return;

    ui.pendingDeleteId = expense.id;
    el.deleteModalMessage.textContent = 'Delete "' + expense.name + '" (' + formatMoney(expense.price) + ')? This can\u2019t be undone.';
    openModal(el.deleteModalOverlay);
  }

  function confirmDeleteExpense() {
    if (!ui.pendingDeleteId) return;

    state.expenses = state.expenses.filter(function (x) { return x.id !== ui.pendingDeleteId; });
    saveState();
    ui.pendingDeleteId = null;
    closeModal(el.deleteModalOverlay);
    announce('Expense deleted.');
    renderAll();
  }

  function cancelDelete() {
    ui.pendingDeleteId = null;
    closeModal(el.deleteModalOverlay);
  }

  /* ------------------------------------------------------------------ *
   * 13. EVENT HANDLERS
   * ------------------------------------------------------------------ */

  // --- Account events ---

  el.loginTab.addEventListener('click', function () { showAuth('login'); });
  el.registerTab.addEventListener('click', function () { showAuth('register'); });

  el.registerForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = el.registerName.value.trim();
    var email = el.registerEmail.value.trim().toLowerCase();
    var password = el.registerPassword.value;
    if (!name || !email || !password) { el.registerError.textContent = 'Please complete every field.'; return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { el.registerError.textContent = 'Enter a valid email address.'; return; }
    if (password.length < 6) { el.registerError.textContent = 'Password must have at least 6 characters.'; return; }
    try {
      var response = await fetch('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ name: name, email: email, password: password })
      });
      var payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Could not create the account.');
      enterApp(payload.user, payload.data);
    } catch (err) {
      el.registerError.textContent = err.message || 'Could not create the account.';
    }
  });

  el.loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var email = el.loginEmail.value.trim().toLowerCase();
    var password = el.loginPassword.value;
    try {
      var response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({ email: email, password: password })
      });
      var payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || 'Email or password is incorrect.');
      enterApp(payload.user, payload.data);
    } catch (err) {
      el.loginError.textContent = err.message || 'Email or password is incorrect.';
    }
  });

  el.logoutBtn.addEventListener('click', logOut);

  // --- Setup form ---

  el.setupForm.addEventListener('submit', function (e) {
    e.preventDefault();

    var result = validateSetupForm(el.startDateInput.value, el.endDateInput.value, el.budgetInput.value);

    showFieldError(el.startDateInput, el.startDateError, result.errors.start);
    showFieldError(el.endDateInput, el.endDateError, result.errors.end);
    showFieldError(el.budgetInput, el.budgetError, result.errors.budget);

    if (!result.valid) return;

    state.startDate = el.startDateInput.value;
    state.endDate = el.endDateInput.value;
    state.totalBudget = result.budgetNum;
    saveState();

    clearFieldErrors([
      [el.startDateInput, el.startDateError],
      [el.endDateInput, el.endDateError],
      [el.budgetInput, el.budgetError]
    ]);

    ui.showSetupForm = false;
    // Force the expense date field to re-default to today/end-of-range.
    el.expenseDateInput.value = '';
    announce('Budget plan saved.');
    renderAll();
  });

  el.startDateInput.addEventListener('change', function () {
    el.endDateInput.min = el.startDateInput.value;
  });

  el.endDateInput.addEventListener('change', function () {
    el.startDateInput.max = el.endDateInput.value;
  });

  el.editPlanBtn.addEventListener('click', function () {
    ui.showSetupForm = true;
    renderAll();
    el.startDateInput.focus();
  });

  // --- Expense form (add) ---

  el.expenseForm.addEventListener('submit', function (e) {
    e.preventDefault();

    var result = validateExpenseForm(el.expenseDateInput.value, el.expenseNameInput.value, el.expensePriceInput.value, false);

    showFieldError(el.expenseDateInput, el.expenseDateError, result.errors.date);
    showFieldError(el.expenseNameInput, el.expenseNameError, result.errors.name);
    showFieldError(el.expensePriceInput, el.expensePriceError, result.errors.price);

    if (!result.valid) return;

    var newExpense = {
      id: 'exp_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      date: el.expenseDateInput.value,
      name: result.trimmedName,
      price: result.priceNum
    };

    state.expenses.push(newExpense);
    saveState();

    ui.lastAddedExpenseId = newExpense.id;

    // Keep the date selected (for quickly logging several items on the
    // same day) but clear the name/price for the next entry.
    el.expenseNameInput.value = '';
    el.expensePriceInput.value = '';
    clearFieldErrors([
      [el.expenseDateInput, el.expenseDateError],
      [el.expenseNameInput, el.expenseNameError],
      [el.expensePriceInput, el.expensePriceError]
    ]);

    announce('Added ' + newExpense.name + ', ' + formatMoney(newExpense.price) + '.');
    renderAll();
    el.expenseNameInput.focus();
  });

  // --- Earning form ---

  el.earningForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var result = validateEarningForm(el.earningDateInput.value, el.earningNameInput.value, el.earningAmountInput.value);
    showFieldError(el.earningDateInput, el.earningDateError, result.errors.date);
    showFieldError(el.earningNameInput, el.earningNameError, result.errors.name);
    showFieldError(el.earningAmountInput, el.earningAmountError, result.errors.amount);
    if (!result.valid) return;

    var earning = {
      id: 'earn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      date: el.earningDateInput.value,
      name: result.trimmedName,
      amount: result.amountNum
    };
    state.earnings.push(earning);
    saveState();
    el.earningNameInput.value = '';
    el.earningAmountInput.value = '';
    clearFieldErrors([
      [el.earningDateInput, el.earningDateError],
      [el.earningNameInput, el.earningNameError],
      [el.earningAmountInput, el.earningAmountError]
    ]);
    announce('Added earning from ' + earning.name + ', ' + formatMoney(earning.amount) + '.');
    renderAll();
    el.earningNameInput.focus();
  });

  // --- History: edit / delete via event delegation ---

  el.historyList.addEventListener('click', function (e) {
    // Find the closest button with a data-action attribute.
    // This handles clicks on the SVG icon inside the button as well.
    var btn = e.target.closest('[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');
    if (!action || !id) return;

    e.preventDefault();
    e.stopPropagation();

    if (action === 'edit') {
      openEditModal(id);
    } else if (action === 'delete') {
      openDeleteModal(id);
    }
  });

  // --- Edit modal events ---

  el.editExpenseForm.addEventListener('submit', function (e) {
    e.preventDefault();
    e.stopPropagation();
    saveEditExpense();
  });

  el.editCancelBtn.addEventListener('click', function (e) {
    e.preventDefault();
    closeEditModal();
  });

  el.editModalOverlay.addEventListener('click', function (e) {
    if (e.target === el.editModalOverlay) {
      closeEditModal();
    }
  });

  // --- Delete modal events ---

  el.deleteConfirmBtn.addEventListener('click', function (e) {
    e.preventDefault();
    confirmDeleteExpense();
  });

  el.deleteCancelBtn.addEventListener('click', function (e) {
    e.preventDefault();
    cancelDelete();
  });

  el.deleteModalOverlay.addEventListener('click', function (e) {
    if (e.target === el.deleteModalOverlay) {
      cancelDelete();
    }
  });

  // --- Reset ---

  el.resetBtn.addEventListener('click', function () { openModal(el.confirmModalOverlay); });
  el.confirmCancelBtn.addEventListener('click', function () { closeModal(el.confirmModalOverlay); });
  el.confirmModalOverlay.addEventListener('click', function (e) {
    if (e.target === el.confirmModalOverlay) closeModal(el.confirmModalOverlay);
  });

  el.confirmResetBtn.addEventListener('click', function () {
    state = getDefaultState();
    saveState();
    ui.showSetupForm = true;
    ui.filterDate = '';
    ui.pendingDeleteId = null;
    ui.editingExpenseId = null;
    el.expenseDateInput.value = '';
    closeModal(el.confirmModalOverlay);
    announce('All data has been reset.');
    renderAll();
  });

  // --- History filter ---

  el.filterDateSelect.addEventListener('change', function () {
    ui.filterDate = el.filterDateSelect.value;
    el.clearFilterBtn.hidden = !ui.filterDate;
    renderAll();
  });

  el.clearFilterBtn.addEventListener('click', function () {
    ui.filterDate = '';
    el.filterDateSelect.value = '';
    el.clearFilterBtn.hidden = true;
    renderAll();
  });

  // --- Escape key closes whichever modal is open ---

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!el.editModalOverlay.hidden) {
      e.preventDefault();
      closeEditModal();
    }
    if (!el.deleteModalOverlay.hidden) {
      e.preventDefault();
      cancelDelete();
    }
    if (!el.confirmModalOverlay.hidden) {
      e.preventDefault();
      closeModal(el.confirmModalOverlay);
    }
  });

  /* ------------------------------------------------------------------ *
   * 14. DATE ROLLOVER
   * If the tab is left open past midnight, "today" changes underneath
   * the app — re-check periodically and on tab focus so the daily
   * limit / remaining days stay correct without needing a refresh.
   * ------------------------------------------------------------------ */

  setInterval(checkForDateRollover, 60 * 1000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkForDateRollover();
  });

  function checkForDateRollover() {
    var now = todayStr();
    if (now !== lastKnownToday) {
      lastKnownToday = now;
      renderAll();
    }
  }

  /* ------------------------------------------------------------------ *
   * 15. INIT
   * ------------------------------------------------------------------ */

  async function init() {
    try {
      var response = await fetch('/api/me', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Not logged in');
      var payload = await response.json();
      enterApp(payload.user, payload.data);
    } catch (err) {
      showAuth('login');
    }
  }

  init();
})();
