setupLogoutLinks();

const LEGACY_STORAGE_KEY = "split-circle-state-v2";

const initialState = {
  settings: {
    groupName: "",
    currency: "INR",
    defaultNote: ""
  },
  members: [],
  expenses: [],
  payments: []
};

const state = structuredClone(initialState);
let startupMessage = "";
let saveQueue = Promise.resolve();

const elements = {
  settingsForm: document.getElementById("settingsForm"),
  groupTitle: document.getElementById("groupTitle"),
  groupName: document.getElementById("groupName"),
  currency: document.getElementById("currency"),
  defaultNote: document.getElementById("defaultNote"),
  exportButton: document.getElementById("exportButton"),
  reportButton: document.getElementById("reportButton"),
  importFile: document.getElementById("importFile"),
  systemMessage: document.getElementById("systemMessage"),
  memberForm: document.getElementById("memberForm"),
  memberName: document.getElementById("memberName"),
  memberContact: document.getElementById("memberContact"),
  memberList: document.getElementById("memberList"),
  expenseForm: document.getElementById("expenseForm"),
  expenseDescription: document.getElementById("expenseDescription"),
  expenseAmount: document.getElementById("expenseAmount"),
  expensePaidBy: document.getElementById("expensePaidBy"),
  expenseDate: document.getElementById("expenseDate"),
  expenseCategory: document.getElementById("expenseCategory"),
  expenseNote: document.getElementById("expenseNote"),
  splitType: document.getElementById("splitType"),
  participantCheckboxes: document.getElementById("participantCheckboxes"),
  shareEditor: document.getElementById("shareEditor"),
  paymentForm: document.getElementById("paymentForm"),
  paymentFrom: document.getElementById("paymentFrom"),
  paymentTo: document.getElementById("paymentTo"),
  paymentAmount: document.getElementById("paymentAmount"),
  paymentDate: document.getElementById("paymentDate"),
  paymentNote: document.getElementById("paymentNote"),
  balanceCards: document.getElementById("balanceCards"),
  settlementList: document.getElementById("settlementList"),
  activityList: document.getElementById("activityList"),
  summaryCards: document.getElementById("summaryCards"),
  categoryBreakdown: document.getElementById("categoryBreakdown"),
  memberSummary: document.getElementById("memberSummary"),
  activitySearch: document.getElementById("activitySearch"),
  activityTypeFilter: document.getElementById("activityTypeFilter"),
  activityMemberFilter: document.getElementById("activityMemberFilter"),
  activityCategoryFilter: document.getElementById("activityCategoryFilter"),
  memberCount: document.getElementById("memberCount"),
  expenseCount: document.getElementById("expenseCount"),
  paymentCount: document.getElementById("paymentCount"),
  resetButton: document.getElementById("resetButton"),
  memberChipTemplate: document.getElementById("memberChipTemplate"),
  checkboxTemplate: document.getElementById("checkboxTemplate"),
  balanceCardTemplate: document.getElementById("balanceCardTemplate"),
  summaryCardTemplate: document.getElementById("summaryCardTemplate"),
  listItemTemplate: document.getElementById("listItemTemplate")
};

void initializeApp();

async function initializeApp() {
  const authenticated = await requireAuth();
  if (!authenticated) {
    return;
  }

  await loadState();
  hydrateSettingsForm();
  bindEvents();
  render();

  if (startupMessage) {
    setSystemMessage(startupMessage);
  }
}

async function loadState() {
  try {
    const payload = await apiRequest("/api/state");
    applyState(payload.state);

    if (!hasMeaningfulData(state)) {
      const legacyState = getLegacyState();
      if (hasMeaningfulData(legacyState)) {
        applyState(legacyState);
        await saveState();
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        startupMessage = "Existing local data moved to MongoDB.";
      }
    }
  } catch (error) {
    startupMessage = "Could not load workspace data from MongoDB.";
  }
}

function saveState() {
  saveQueue = saveQueue
    .then(() => apiRequest("/api/state", {
      method: "PUT",
      body: JSON.stringify({ state })
    }))
    .then(() => {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    })
    .catch((error) => {
      setSystemMessage(error.message || "Could not save workspace data.");
    });

  return saveQueue;
}

function bindEvents() {
  elements.settingsForm.addEventListener("submit", (event) => {
    void handleSaveSettings(event);
  });
  elements.exportButton.addEventListener("click", handleExport);
  elements.reportButton.addEventListener("click", () => {
    void handleEmailReport();
  });
  elements.importFile.addEventListener("change", (event) => {
    void handleImport(event);
  });
  elements.memberForm.addEventListener("submit", (event) => {
    void handleAddMember(event);
  });
  elements.expenseForm.addEventListener("submit", (event) => {
    void handleAddExpense(event);
  });
  elements.paymentForm.addEventListener("submit", (event) => {
    void handleAddPayment(event);
  });
  elements.resetButton.addEventListener("click", () => {
    void clearAllData();
  });
  elements.splitType.addEventListener("change", renderShareEditor);
  elements.participantCheckboxes.addEventListener("change", renderShareEditor);
  elements.expenseAmount.addEventListener("input", renderShareEditor);
  elements.activitySearch.addEventListener("input", renderActivity);
  elements.activityTypeFilter.addEventListener("change", renderActivity);
  elements.activityMemberFilter.addEventListener("change", renderActivity);
  elements.activityCategoryFilter.addEventListener("change", renderActivity);
}

function hydrateSettingsForm() {
  elements.groupName.value = state.settings.groupName;
  elements.currency.value = state.settings.currency;
  elements.defaultNote.value = state.settings.defaultNote;
}

function applyState(nextState) {
  const normalized = normalizeState(nextState);
  state.settings = normalized.settings;
  state.members.splice(0, state.members.length, ...normalized.members);
  state.expenses.splice(0, state.expenses.length, ...normalized.expenses);
  state.payments.splice(0, state.payments.length, ...normalized.payments);
}

function normalizeState(candidate) {
  return {
    settings: {
      ...initialState.settings,
      ...(candidate?.settings || {})
    },
    members: Array.isArray(candidate?.members) ? candidate.members : [],
    expenses: Array.isArray(candidate?.expenses) ? candidate.expenses : [],
    payments: Array.isArray(candidate?.payments) ? candidate.payments : []
  };
}

function getLegacyState() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return normalizeState(JSON.parse(raw));
  } catch (error) {
    return null;
  }
}

function hasMeaningfulData(candidate) {
  if (!candidate) {
    return false;
  }

  return Boolean(
    candidate.settings?.groupName
    || candidate.settings?.defaultNote
    || candidate.members?.length
    || candidate.expenses?.length
    || candidate.payments?.length
  );
}

async function handleSaveSettings(event) {
  event.preventDefault();
  state.settings.groupName = elements.groupName.value.trim();
  state.settings.currency = elements.currency.value;
  state.settings.defaultNote = elements.defaultNote.value.trim();
  await commit("Settings saved.");
}

function handleExport() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const groupName = slugify(state.settings.groupName || "splitcircle-group");

  link.href = url;
  link.download = `${groupName}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setSystemMessage("Group data exported.");
}

async function handleEmailReport() {
  try {
    elements.reportButton.disabled = true;
    elements.reportButton.textContent = "Sending report...";
    setSystemMessage("Preparing your PDF report.");

    const payload = await apiRequest("/api/report/email", {
      method: "POST"
    });

    setSystemMessage(`PDF report sent to ${payload.email}.`);
  } catch (error) {
    setSystemMessage(error.message || "Could not send the PDF report.");
  } finally {
    elements.reportButton.disabled = false;
    elements.reportButton.textContent = "Get report";
  }
}

async function handleImport(event) {
  const [file] = event.target.files;
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = JSON.parse(String(reader.result));
      applyState(imported);
      hydrateSettingsForm();
      await commit("Group data imported.");
    } catch (error) {
      setSystemMessage("Import failed. Please choose a valid JSON export.");
    } finally {
      elements.importFile.value = "";
    }
  };

  reader.readAsText(file);
}

async function handleAddMember(event) {
  event.preventDefault();
  const name = elements.memberName.value.trim();
  const contact = elements.memberContact.value.trim();

  if (!name) {
    setSystemMessage("Member name is required.");
    return;
  }

  const duplicate = state.members.some((member) => member.name.toLowerCase() === name.toLowerCase());
  if (duplicate) {
    setSystemMessage("That member already exists.");
    return;
  }

  state.members.push({
    id: crypto.randomUUID(),
    name,
    contact
  });

  elements.memberForm.reset();
  await commit("Member added.");
}

async function handleAddExpense(event) {
  event.preventDefault();
  if (state.members.length < 2) {
    setSystemMessage("Add at least two members before logging an expense.");
    return;
  }

  const description = elements.expenseDescription.value.trim();
  const amount = Number(elements.expenseAmount.value);
  const paidBy = elements.expensePaidBy.value;
  const participants = getSelectedParticipants();
  const splitType = elements.splitType.value;
  const date = elements.expenseDate.value || getToday();
  const category = elements.expenseCategory.value;
  const note = elements.expenseNote.value.trim();

  if (!description || !amount || amount <= 0 || !paidBy || participants.length === 0) {
    setSystemMessage("Complete all required expense details first.");
    return;
  }

  const shares = splitType === "exact"
    ? getExactShares(participants, amount)
    : buildEqualShares(participants, amount);

  if (!shares) {
    return;
  }

  state.expenses.unshift({
    id: crypto.randomUUID(),
    description,
    amount: roundCurrency(amount),
    paidBy,
    participants,
    splitType,
    shares,
    date,
    category,
    note,
    createdAt: new Date().toISOString()
  });

  elements.expenseForm.reset();
  await commit("Expense added.");
}

async function handleAddPayment(event) {
  event.preventDefault();
  const from = elements.paymentFrom.value;
  const to = elements.paymentTo.value;
  const amount = Number(elements.paymentAmount.value);
  const date = elements.paymentDate.value || getToday();
  const note = elements.paymentNote.value.trim() || state.settings.defaultNote.trim();

  if (!from || !to || from === to || !amount || amount <= 0) {
    setSystemMessage("Choose two different people and enter a valid payment amount.");
    return;
  }

  state.payments.unshift({
    id: crypto.randomUUID(),
    from,
    to,
    amount: roundCurrency(amount),
    date,
    note,
    createdAt: new Date().toISOString()
  });

  elements.paymentForm.reset();
  await commit("Payment recorded.");
}

function getSelectedParticipants() {
  return Array.from(
    elements.participantCheckboxes.querySelectorAll("input:checked"),
    (input) => input.value
  );
}

function buildEqualShares(participants, amount) {
  const equalShare = roundCurrency(amount / participants.length);
  const shares = {};
  let runningTotal = 0;

  participants.forEach((participantId, index) => {
    const value = index === participants.length - 1
      ? roundCurrency(amount - runningTotal)
      : equalShare;
    shares[participantId] = value;
    runningTotal = roundCurrency(runningTotal + value);
  });

  return shares;
}

function getExactShares(participants, amount) {
  const shareInputs = Array.from(elements.shareEditor.querySelectorAll("input[data-member-id]"));
  const shares = {};
  let total = 0;

  for (const input of shareInputs) {
    const memberId = input.dataset.memberId;
    if (!participants.includes(memberId)) {
      continue;
    }

    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0) {
      setSystemMessage("Exact shares must be valid positive amounts.");
      return null;
    }

    shares[memberId] = roundCurrency(value);
    total = roundCurrency(total + value);
  }

  if (Math.abs(total - amount) > 0.01) {
    setSystemMessage("Exact shares must add up to the full expense amount.");
    return null;
  }

  return shares;
}

async function clearAllData() {
  const confirmed = window.confirm("Clear the current group, expenses, payments, and settings?");
  if (!confirmed) {
    return;
  }

  state.settings = structuredClone(initialState.settings);
  state.members.splice(0, state.members.length);
  state.expenses.splice(0, state.expenses.length);
  state.payments.splice(0, state.payments.length);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  resetInterface();
  await commit("All data cleared.");
}

function resetInterface() {
  elements.settingsForm.reset();
  hydrateSettingsForm();
  elements.memberForm.reset();
  elements.expenseForm.reset();
  elements.paymentForm.reset();
  elements.importFile.value = "";
  elements.activitySearch.value = "";
  elements.activityTypeFilter.value = "all";
  elements.activityMemberFilter.value = "all";
  elements.activityCategoryFilter.value = "all";
  elements.shareEditor.classList.add("hidden");
  elements.shareEditor.innerHTML = "";
}

async function commit(message) {
  await saveState();
  render();
  if (message) {
    setSystemMessage(message);
  }
}

function render() {
  renderHeader();
  renderMembers();
  renderSelectors();
  renderShareEditor();
  renderStats();
  renderSummaryCards();
  renderBalances();
  renderCategoryBreakdown();
  renderMemberSummary();
  renderSettlements();
  renderActivity();
}

function renderHeader() {
  const title = state.settings.groupName.trim() || "Your group expense workspace";
  elements.groupTitle.textContent = title;
}

function renderMembers() {
  elements.memberList.innerHTML = "";

  if (state.members.length === 0) {
    elements.memberList.className = "chip-grid empty-state";
    elements.memberList.textContent = "Add members to start sharing expenses.";
    return;
  }

  elements.memberList.className = "chip-grid";
  state.members.forEach((member) => {
    const fragment = elements.memberChipTemplate.content.cloneNode(true);
    const span = fragment.querySelector("span");
    const meta = fragment.querySelector("p");
    const button = fragment.querySelector("button");

    span.textContent = member.name;
    meta.textContent = member.contact || "No contact added";
    button.addEventListener("click", () => {
      void removeMember(member.id);
    });
    elements.memberList.appendChild(fragment);
  });
}

function renderSelectors() {
  fillSelect(elements.expensePaidBy, state.members, "Select payer");
  fillSelect(elements.paymentFrom, state.members, "Select sender");
  fillSelect(elements.paymentTo, state.members, "Select receiver");
  fillSelect(elements.activityMemberFilter, state.members, "All members", "all");

  const selectedParticipants = new Set(getSelectedParticipants());
  elements.participantCheckboxes.innerHTML = "";

  if (state.members.length === 0) {
    elements.participantCheckboxes.className = "checkbox-grid empty-state";
    elements.participantCheckboxes.textContent = "Members will appear here for splitting.";
    return;
  }

  elements.participantCheckboxes.className = "checkbox-grid";
  state.members.forEach((member) => {
    const fragment = elements.checkboxTemplate.content.cloneNode(true);
    const input = fragment.querySelector("input");
    const span = fragment.querySelector("span");

    input.value = member.id;
    input.checked = selectedParticipants.size === 0 || selectedParticipants.has(member.id);
    span.textContent = member.name;
    elements.participantCheckboxes.appendChild(fragment);
  });
}

function renderShareEditor() {
  const participants = getSelectedParticipants();

  if (elements.splitType.value !== "exact" || participants.length === 0) {
    elements.shareEditor.classList.add("hidden");
    elements.shareEditor.innerHTML = "";
    return;
  }

  const amount = Number(elements.expenseAmount.value) || 0;
  const equalShares = buildEqualShares(participants, amount);
  elements.shareEditor.classList.remove("hidden");
  elements.shareEditor.innerHTML = "";

  participants.forEach((memberId) => {
    const wrapper = document.createElement("label");
    const name = lookupMember(memberId);
    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.01";
    input.min = "0";
    input.dataset.memberId = memberId;
    input.placeholder = String(equalShares[memberId] ?? 0);
    wrapper.innerHTML = `<span>${name} share</span>`;
    wrapper.appendChild(input);
    elements.shareEditor.appendChild(wrapper);
  });
}

function renderStats() {
  elements.memberCount.textContent = state.members.length;
  elements.expenseCount.textContent = state.expenses.length;
  elements.paymentCount.textContent = state.payments.length;
}

function renderSummaryCards() {
  const balances = calculateBalances();
  const totalSpent = state.expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const totalPaidBack = state.payments.reduce((sum, payment) => sum + payment.amount, 0);
  const openBalance = balances.reduce((sum, item) => sum + Math.abs(item.balance), 0) / 2;
  const lastActivity = buildActivityFeed()[0];

  const summary = [
    { label: "Total spent", value: formatCurrency(totalSpent) },
    { label: "Payments recorded", value: formatCurrency(totalPaidBack) },
    { label: "Outstanding balance", value: formatCurrency(openBalance) },
    { label: "Latest activity", value: lastActivity ? formatShortDate(lastActivity.date) : "No activity yet" }
  ];

  elements.summaryCards.innerHTML = "";
  summary.forEach((item) => {
    const fragment = elements.summaryCardTemplate.content.cloneNode(true);
    fragment.querySelector("p").textContent = item.label;
    fragment.querySelector("strong").textContent = item.value;
    elements.summaryCards.appendChild(fragment);
  });
}

function renderBalances() {
  const balances = calculateBalances();
  elements.balanceCards.innerHTML = "";

  if (balances.length === 0) {
    elements.balanceCards.className = "balance-grid empty-state";
    elements.balanceCards.textContent = "Balances will show once the group has members.";
    return;
  }

  elements.balanceCards.className = "balance-grid";
  balances.forEach((entry) => {
    const fragment = elements.balanceCardTemplate.content.cloneNode(true);
    const title = fragment.querySelector("h3");
    const subtitle = fragment.querySelector("p");
    const total = fragment.querySelector("strong");

    title.textContent = entry.name;
    subtitle.textContent = entry.balance > 0 ? "Should receive" : entry.balance < 0 ? "Needs to pay" : "All square";
    total.textContent = formatCurrency(Math.abs(entry.balance));
    total.className = entry.balance > 0 ? "positive" : entry.balance < 0 ? "negative" : "neutral";
    elements.balanceCards.appendChild(fragment);
  });
}

function renderCategoryBreakdown() {
  const totals = new Map();
  const totalSpent = state.expenses.reduce((sum, expense) => sum + expense.amount, 0);

  state.expenses.forEach((expense) => {
    totals.set(expense.category, roundCurrency((totals.get(expense.category) || 0) + expense.amount));
  });

  elements.categoryBreakdown.innerHTML = "";

  if (totals.size === 0) {
    elements.categoryBreakdown.className = "list-stack empty-state";
    elements.categoryBreakdown.textContent = "Category insights appear after you log expenses.";
    return;
  }

  elements.categoryBreakdown.className = "list-stack";
  Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([category, amount]) => {
      const item = document.createElement("article");
      const percentage = totalSpent ? Math.round((amount / totalSpent) * 100) : 0;
      item.className = "metric-item";
      item.innerHTML = `
        <div class="metric-row">
          <h3>${category}</h3>
          <strong>${formatCurrency(amount)}</strong>
        </div>
        <p>${percentage}% of total spend</p>
        <div class="progress-track">
          <span style="width: ${percentage}%"></span>
        </div>
      `;
      elements.categoryBreakdown.appendChild(item);
    });
}

function renderMemberSummary() {
  const balances = calculateBalances();
  elements.memberSummary.innerHTML = "";

  if (balances.length === 0) {
    elements.memberSummary.className = "list-stack empty-state";
    elements.memberSummary.textContent = "Member insights will appear after you add people.";
    return;
  }

  elements.memberSummary.className = "list-stack";
  balances.forEach((entry) => {
    const paid = state.expenses
      .filter((expense) => expense.paidBy === entry.id)
      .reduce((sum, expense) => sum + expense.amount, 0);
    const settled = state.payments
      .filter((payment) => payment.from === entry.id)
      .reduce((sum, payment) => sum + payment.amount, 0);

    const item = document.createElement("article");
    item.className = "metric-item";
    item.innerHTML = `
      <div class="metric-row">
        <h3>${entry.name}</h3>
        <strong class="${entry.balance > 0 ? "positive" : entry.balance < 0 ? "negative" : "neutral"}">${formatCurrency(Math.abs(entry.balance))}</strong>
      </div>
      <p>Paid ${formatCurrency(paid)} | Settled ${formatCurrency(settled)} | ${entry.balance > 0 ? "Should receive" : entry.balance < 0 ? "Needs to pay" : "Balanced"}</p>
    `;
    elements.memberSummary.appendChild(item);
  });
}

function renderSettlements() {
  const settlements = calculateSettlements();
  elements.settlementList.innerHTML = "";

  if (settlements.length === 0) {
    elements.settlementList.className = "list-stack empty-state";
    elements.settlementList.textContent = "No suggested settle-up needed right now.";
    return;
  }

  elements.settlementList.className = "list-stack";
  settlements.forEach((item) => {
    const fragment = elements.listItemTemplate.content.cloneNode(true);
    const actionButton = fragment.querySelector(".danger-button");

    fragment.querySelector("h3").textContent = `${item.from} pays ${item.to}`;
    fragment.querySelector("p").textContent = `Suggested transfer to settle balances as of ${formatShortDate(getToday())}.`;
    fragment.querySelector("strong").textContent = formatCurrency(item.amount);
    actionButton.remove();
    elements.settlementList.appendChild(fragment);
  });
}

function renderActivity() {
  const items = getFilteredActivity();
  elements.activityList.innerHTML = "";

  if (items.length === 0) {
    elements.activityList.className = "list-stack empty-state";
    elements.activityList.textContent = "Transactions and payments will appear here.";
    return;
  }

  elements.activityList.className = "list-stack";
  items.forEach((item) => {
    const fragment = elements.listItemTemplate.content.cloneNode(true);
    const deleteButton = fragment.querySelector(".danger-button");

    fragment.querySelector("h3").textContent = item.title;
    fragment.querySelector("p").textContent = item.meta;
    fragment.querySelector("strong").textContent = formatCurrency(item.amount);
    deleteButton.addEventListener("click", () => {
      void deleteActivity(item.type, item.id);
    });
    elements.activityList.appendChild(fragment);
  });
}

function getFilteredActivity() {
  const query = elements.activitySearch.value.trim().toLowerCase();
  const typeFilter = elements.activityTypeFilter.value;
  const memberFilter = elements.activityMemberFilter.value;
  const categoryFilter = elements.activityCategoryFilter.value;

  return buildActivityFeed().filter((item) => {
    if (typeFilter !== "all" && item.type !== typeFilter) {
      return false;
    }

    if (memberFilter !== "all" && !item.members.includes(memberFilter)) {
      return false;
    }

    if (categoryFilter !== "all") {
      if (categoryFilter === "payment" && item.type !== "payment") {
        return false;
      }

      if (categoryFilter !== "payment" && item.type === "expense" && item.category !== categoryFilter) {
        return false;
      }

      if (categoryFilter !== "payment" && item.type === "payment") {
        return false;
      }
    }

    if (!query) {
      return true;
    }

    return `${item.title} ${item.meta}`.toLowerCase().includes(query);
  });
}

function calculateBalances() {
  const balances = new Map(state.members.map((member) => [member.id, 0]));

  state.expenses.forEach((expense) => {
    balances.set(expense.paidBy, roundCurrency((balances.get(expense.paidBy) || 0) + expense.amount));
    Object.entries(expense.shares || {}).forEach(([participantId, share]) => {
      balances.set(participantId, roundCurrency((balances.get(participantId) || 0) - Number(share)));
    });
  });

  state.payments.forEach((payment) => {
    balances.set(payment.from, roundCurrency((balances.get(payment.from) || 0) + payment.amount));
    balances.set(payment.to, roundCurrency((balances.get(payment.to) || 0) - payment.amount));
  });

  return state.members
    .map((member) => ({
      id: member.id,
      name: member.name,
      balance: roundCurrency(balances.get(member.id) || 0)
    }))
    .sort((a, b) => b.balance - a.balance);
}

function calculateSettlements() {
  const balances = calculateBalances();
  const creditors = balances
    .filter((entry) => entry.balance > 0.009)
    .map((entry) => ({ ...entry }));
  const debtors = balances
    .filter((entry) => entry.balance < -0.009)
    .map((entry) => ({ ...entry, balance: Math.abs(entry.balance) }));

  const settlements = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = roundCurrency(Math.min(creditor.balance, debtor.balance));

    settlements.push({
      from: debtor.name,
      to: creditor.name,
      amount
    });

    creditor.balance = roundCurrency(creditor.balance - amount);
    debtor.balance = roundCurrency(debtor.balance - amount);

    if (creditor.balance <= 0.009) {
      creditorIndex += 1;
    }

    if (debtor.balance <= 0.009) {
      debtorIndex += 1;
    }
  }

  return settlements;
}

function buildActivityFeed() {
  const expenses = state.expenses.map((expense) => ({
    id: expense.id,
    type: "expense",
    title: `${lookupMember(expense.paidBy)} paid for ${expense.description}`,
    meta: `${expense.category} | ${expense.participants.map(lookupMember).join(", ")} | ${formatShortDate(expense.date)}${expense.note ? ` | ${expense.note}` : ""}`,
    amount: expense.amount,
    date: expense.date,
    category: expense.category,
    members: [expense.paidBy, ...expense.participants],
    createdAt: expense.createdAt
  }));

  const payments = state.payments.map((payment) => ({
    id: payment.id,
    type: "payment",
    title: `${lookupMember(payment.from)} paid ${lookupMember(payment.to)}`,
    meta: `${formatShortDate(payment.date)}${payment.note ? ` | ${payment.note}` : ""}`,
    amount: payment.amount,
    date: payment.date,
    category: "payment",
    members: [payment.from, payment.to],
    createdAt: payment.createdAt
  }));

  return [...expenses, ...payments].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function deleteActivity(type, id) {
  if (type === "expense") {
    const index = state.expenses.findIndex((expense) => expense.id === id);
    if (index >= 0) {
      state.expenses.splice(index, 1);
      await commit("Expense deleted.");
    }
    return;
  }

  const index = state.payments.findIndex((payment) => payment.id === id);
  if (index >= 0) {
    state.payments.splice(index, 1);
    await commit("Payment deleted.");
  }
}

async function removeMember(memberId) {
  const isReferenced = state.expenses.some((expense) => expense.paidBy === memberId || expense.participants.includes(memberId))
    || state.payments.some((payment) => payment.from === memberId || payment.to === memberId);

  if (isReferenced) {
    setSystemMessage("This member is already part of saved transactions and cannot be removed.");
    return;
  }

  const index = state.members.findIndex((member) => member.id === memberId);
  if (index >= 0) {
    state.members.splice(index, 1);
    await commit("Member removed.");
  }
}

function fillSelect(select, options, placeholder, placeholderValue = "") {
  const currentValue = select.value;
  select.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = placeholderValue;
  defaultOption.textContent = placeholder;
  select.appendChild(defaultOption);

  options.forEach((option) => {
    const item = document.createElement("option");
    item.value = option.id;
    item.textContent = option.name;
    select.appendChild(item);
  });

  if (options.some((option) => option.id === currentValue)) {
    select.value = currentValue;
  }
}

function lookupMember(memberId) {
  return state.members.find((member) => member.id === memberId)?.name || "Unknown member";
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: state.settings.currency || "INR",
    maximumFractionDigits: 2
  }).format(amount);
}

function formatShortDate(dateValue) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(dateValue));
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function setSystemMessage(message) {
  elements.systemMessage.textContent = message;
}

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
