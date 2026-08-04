const STORAGE_KEY = "codes";
const DRAFT_KEY = "formDraft";
const SORT_KEY = "listSort";
const VALIDITY_DAYS = 59;
const WARNING_DAYS = 5;
const CRITICAL_DAYS = 2;
const ACTIVATION_WAIT_DAYS = 2;
const VALIDATION_DEBOUNCE_MS = 500;
/** ponytail: set true to re-enable remote validation against compraentradas */
const VALIDATION_ENABLED = true;

const tabButtons = document.querySelectorAll(".tabs__btn");
const panels = document.querySelectorAll(".panel");
const form = document.getElementById("code-form");
const codeInput = document.getElementById("code-input");
const codeValidation = document.getElementById("code-validation");
const submitBtn = document.getElementById("submit-btn");
const clearFormBtn = document.getElementById("clear-form-btn");
const seatsInput = document.getElementById("seats-input");
const dateTrigger = document.getElementById("date-trigger");
const dateTriggerText = document.getElementById("date-trigger-text");
const dateCalendar = document.getElementById("date-calendar");
const dateMonthLabel = document.getElementById("date-month-label");
const dateGrid = document.getElementById("date-grid");
const datePrev = document.getElementById("date-prev");
const dateNext = document.getElementById("date-next");
const dateToday = document.getElementById("date-today");
const codeList = document.getElementById("code-list");
const emptyList = document.getElementById("empty-list");
const sortButtons = document.querySelectorAll(".sort-toggle__btn[data-sort]");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importInput = document.getElementById("import-input");
const listMessage = document.getElementById("list-message");
const formMessage = document.getElementById("form-message");
const barcodeOverlay = document.getElementById("barcode-overlay");
const barcodeOverlaySvg = document.getElementById("barcode-overlay-svg");
const barcodeOverlayClose = document.getElementById("barcode-overlay-close");
const viewLogin = document.getElementById("view-login");
const viewApp = document.getElementById("view-app");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const loginMessage = document.getElementById("login-message");
const authEmail = document.getElementById("auth-email");

let activeTabId = "list";
let listSort = "expiry";
let listSortDir = "asc";
let authSession = null;

let validationState = { status: "idle", code: "" };
let validationRequestId = 0;
let validationDebounceTimer = null;

// ─── Barcode overlay ───────────────────────────────────────────────────────

function openBarcodeOverlay(code) {
  barcodeOverlaySvg.innerHTML = renderBarcodeSvg(code);
  barcodeOverlay.hidden = false;
  barcodeOverlayClose.focus();
}

function closeBarcodeOverlay() {
  if (barcodeOverlay.hidden) return;
  barcodeOverlay.hidden = true;
  barcodeOverlaySvg.innerHTML = "";
}

barcodeOverlayClose.addEventListener("click", closeBarcodeOverlay);
barcodeOverlay.addEventListener("click", (event) => {
  if (event.target === barcodeOverlay) closeBarcodeOverlay();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeBarcodeOverlay();
});

// ─── Code validation ────────────────────────────────────────────────────────

function isSavableStatus(status) {
  return status === "valid" || status === "not_yet_valid";
}

async function validateCode(code) {
  if (!VALIDATION_ENABLED) return { status: "valid" };
  return browser.runtime.sendMessage({
    type: "validate-code",
    code,
  });
}

function isFormComplete() {
  const seats = Number.parseInt(seatsInput.value, 10);
  return codeInput.value.trim().length > 0 && Number.isInteger(seats) && seats >= 1;
}

function resetValidation(skipSave = false) {
  validationState = { status: "idle", code: "" };
  updateValidationUI();
  if (!skipSave) {
    saveFormDraft();
  }
}

function updateValidationUI() {
  const code = codeInput.value.trim();

  codeInput.classList.remove("form__input--valid", "form__input--invalid", "form__input--pending");

  if (!code) {
    codeValidation.hidden = true;
    submitBtn.disabled = true;
    return;
  }

  if (!VALIDATION_ENABLED) {
    codeValidation.hidden = true;
    submitBtn.disabled = !isFormComplete();
    return;
  }

  const labels = {
    loading: "Comprobando código…",
    valid: "Código válido",
    invalid: "El código no es válido",
    expired: "El código ha caducado",
    not_yet_valid: "Pendiente: se podrá usar 24h después de su creación",
    seats_redeemed: "Todas las butacas ya han sido canjeadas",
    duplicate: "Este código ya está guardado",
    error: "No se pudo comprobar el código. Revisa tu conexión.",
  };

  codeValidation.hidden = false;
  codeValidation.className = `code-validation code-validation--${validationState.status}`;
  codeValidation.textContent = labels[validationState.status] || "";

  if (validationState.status === "valid") {
    codeInput.classList.add("form__input--valid");
  } else if (validationState.status === "not_yet_valid") {
    codeInput.classList.add("form__input--pending");
  } else if (
    ["invalid", "expired", "seats_redeemed", "duplicate", "error"].includes(
      validationState.status,
    )
  ) {
    codeInput.classList.add("form__input--invalid");
  }

  const canSave =
    isFormComplete() &&
    isSavableStatus(validationState.status) &&
    validationState.code === code;
  submitBtn.disabled = !canSave;
}

async function validateCodeInput(code) {
  const requestId = ++validationRequestId;

  validationState = { status: "loading", code };
  updateValidationUI();

  try {
    if (await codeExists(code)) {
      if (requestId !== validationRequestId) return;

      validationState = { status: "duplicate", code };
      updateValidationUI();
      saveFormDraft();
      return { status: "duplicate" };
    }

    const result = await validateCode(code);
    if (requestId !== validationRequestId) return;

    validationState = { status: result.status, code };
    updateValidationUI();
    saveFormDraft();
    return result;
  } catch {
    if (requestId !== validationRequestId) return;

    validationState = { status: "error", code };
    updateValidationUI();
    return { status: "error" };
  }
}

function scheduleValidation() {
  clearTimeout(validationDebounceTimer);

  const code = codeInput.value.trim();
  if (!code) {
    validationRequestId += 1;
    resetValidation();
    return;
  }

  if (!VALIDATION_ENABLED) {
    validationState = { status: "valid", code };
    updateValidationUI();
    saveFormDraft();
    return;
  }

  validationState = { status: "loading", code };
  updateValidationUI();

  validationDebounceTimer = setTimeout(() => {
    validateCodeInput(code);
  }, VALIDATION_DEBOUNCE_MS);
}

// ─── Date utilities ─────────────────────────────────────────────────────────

function formatDateForInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

let selectedDate = new Date();
let visibleMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function isFutureDate(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()) > getToday();
}

function canGoToNextMonth() {
  const today = new Date();
  return (
    visibleMonth.year < today.getFullYear() ||
    (visibleMonth.year === today.getFullYear() && visibleMonth.month < today.getMonth())
  );
}

function getSelectedDate() {
  return formatDateForInput(selectedDate);
}

function setDate(date, skipSave = false) {
  const normalized = isFutureDate(date) ? getToday() : new Date(date.getFullYear(), date.getMonth(), date.getDate());
  selectedDate = normalized;
  visibleMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };
  updateDateTrigger();
  renderCalendar();
  updateValidationUI();
  if (!skipSave) {
    saveFormDraft();
  }
}

function initDate() {
  setDate(new Date());
}

function updateDateTrigger() {
  dateTriggerText.textContent = formatReadableDate(getSelectedDate());
}

function toggleCalendar(open) {
  const visible = open ?? dateCalendar.hidden;
  dateCalendar.hidden = !visible;
  dateTrigger.setAttribute("aria-expanded", String(visible));
  if (visible) {
    visibleMonth = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };
    renderCalendar();
  }
}

function renderCalendar() {
  const { year, month } = visibleMonth;
  dateMonthLabel.textContent = new Intl.DateTimeFormat("es-ES", {
    month: "2-digit",
    year: "numeric",
  }).format(new Date(year, month, 1));

  dateGrid.innerHTML = "";

  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = formatDateForInput(new Date());
  const selectedStr = getSelectedDate();
  const today = getToday();

  dateNext.disabled = !canGoToNextMonth();

  for (let i = 0; i < offset; i++) {
    const empty = document.createElement("span");
    empty.className = "datepicker__cell datepicker__cell--empty";
    dateGrid.appendChild(empty);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayDate = new Date(year, month, day);
    const dateStr = formatDateForInput(dayDate);
    const isFuture = dayDate > today;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "datepicker__cell datepicker__day";
    btn.textContent = day;
    btn.setAttribute("role", "gridcell");
    btn.dataset.date = dateStr;

    if (isFuture) {
      btn.classList.add("datepicker__day--disabled");
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        setDate(dayDate);
        toggleCalendar(false);
      });
    }

    if (dateStr === selectedStr) btn.classList.add("datepicker__day--selected");
    if (dateStr === todayStr) btn.classList.add("datepicker__day--today");

    dateGrid.appendChild(btn);
  }
}

function addDays(dateStr, days) {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatDateForInput(date);
}

function formatReadableDate(dateStr) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parseLocalDate(dateStr));
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function getDaysSince(dateStr) {
  return Math.floor((getToday() - parseLocalDate(dateStr)) / MS_PER_DAY);
}

function getDaysRemaining(expiresAt) {
  return Math.floor((parseLocalDate(expiresAt) - getToday()) / MS_PER_DAY);
}

// ─── Storage ────────────────────────────────────────────────────────────────

async function getCodes() {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

async function codeExists(code) {
  const normalized = code.trim();
  const codes = await getCodes();
  return codes.some((item) => item.code.trim() === normalized);
}

async function saveCodes(codes) {
  await browser.storage.local.set({ [STORAGE_KEY]: codes });
}

async function saveCode(code, createdAt, seats, pendingActivation = false) {
  if (!authSession) return false;

  const expiresAt = addDays(createdAt, VALIDITY_DAYS);
  const codes = await getCodes();
  const normalized = code.trim();

  if (codes.some((item) => item.code.trim() === normalized)) {
    return false;
  }

  const entry = { code: normalized, createdAt, expiresAt, seats };
  if (pendingActivation) {
    entry.pendingActivation = true;
  }
  codes.push(entry);
  await saveCodes(codes);
  try {
    await upsertRemoteCode(entry);
  } catch {
    /* cache kept; retry on next sync */
  }
  return true;
}

async function deleteCodeByValue(code) {
  if (!authSession) return;

  const normalized = code.trim();
  const codes = await getCodes();
  const next = codes.filter((item) => item.code.trim() !== normalized);
  if (next.length === codes.length) return;
  try {
    await deleteRemoteCode(normalized);
  } catch {
    showListMessage("No se pudo borrar en la nube.", "error");
    return;
  }
  await saveCodes(next);
}

async function activateReadyCodes(codes) {
  let changed = false;
  const activated = [];
  const updated = codes.map((item) => {
    if (item.pendingActivation && getDaysSince(item.createdAt) >= ACTIVATION_WAIT_DAYS) {
      changed = true;
      const { pendingActivation, ...rest } = item;
      activated.push(rest);
      return rest;
    }
    return item;
  });

  if (changed) {
    await saveCodes(updated);
    if (authSession) {
      for (const item of activated) {
        try {
          await upsertRemoteCode(item);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return updated;
}

async function purgeExpired() {
  const codes = await getCodes();
  const active = codes.filter((item) => getDaysRemaining(item.expiresAt) > 0);
  if (active.length !== codes.length) {
    await saveCodes(active);
    if (authSession) {
      const kept = new Set(active.map((item) => item.code.trim()));
      for (const item of codes) {
        if (!kept.has(item.code.trim())) {
          try {
            await deleteRemoteCode(item.code);
          } catch {
            /* ignore */
          }
        }
      }
    }
  }
  return activateReadyCodes(active);
}

function clearForm() {
  validationRequestId += 1;
  clearTimeout(validationDebounceTimer);
  codeInput.value = "";
  seatsInput.value = "";
  toggleCalendar(false);
  initDate();
  resetValidation();
}

// ─── Form draft persistence ───────────────────────────────────────────────────

async function saveFormDraft() {
  await browser.storage.local.set({
    [DRAFT_KEY]: {
      code: codeInput.value,
      seats: seatsInput.value,
      createdAt: getSelectedDate(),
      activeTab: activeTabId,
      validationState,
    },
  });
}

async function loadFormDraft() {
  const result = await browser.storage.local.get([DRAFT_KEY, SORT_KEY]);
  const draft = result[DRAFT_KEY];

  if (result[SORT_KEY]) {
    loadSortPrefs(result[SORT_KEY]);
    updateSortButtons();
  }

  if (!draft) {
    initDate();
    resetValidation();
    return;
  }

  codeInput.value = draft.code || "";
  seatsInput.value = draft.seats || "";

  if (draft.createdAt) {
    setDate(parseLocalDate(draft.createdAt), true);
  } else {
    initDate();
  }

  if (draft.activeTab) {
    activateTab(draft.activeTab, false);
  }

  if (draft.validationState && draft.validationState.code === codeInput.value.trim()) {
    validationState = draft.validationState;
    updateValidationUI();
  } else if (codeInput.value.trim()) {
    scheduleValidation();
  } else {
    resetValidation();
  }
}

async function clearFormDraft() {
  await browser.storage.local.remove(DRAFT_KEY);
}

function sanitizeSeatsInput() {
  const sanitized = seatsInput.value.replace(/\D/g, "");
  if (seatsInput.value !== sanitized) {
    seatsInput.value = sanitized;
  }
}

function isWaitingForActivation(item) {
  return Boolean(item.pendingActivation) && getDaysSince(item.createdAt) < ACTIVATION_WAIT_DAYS;
}

function getDaysUntilActivation(item) {
  return Math.max(ACTIVATION_WAIT_DAYS - getDaysSince(item.createdAt), 0);
}

function getCardUrgency(daysRemaining, waiting) {
  if (waiting) return "pending";
  if (daysRemaining <= CRITICAL_DAYS) return "critical";
  if (daysRemaining <= WARNING_DAYS) return "warning";
  return "normal";
}

const SORT_ICON_PATHS = {
  expiry: {
    // schedule (asc) / history (desc)
    asc: "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z",
    desc: "M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
  },
  seats: {
    // event_seat (asc) / person_add (desc)
    asc: "M4 18v3h3v-3h10v3h3v-6H4zm15-8h3v3h-3zM2 10h3v3H2zm15 3H7V5c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2z",
    desc: "M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  },
};

const SORT_LABELS = {
  expiry: { asc: "Caducidad: menor a mayor", desc: "Caducidad: mayor a menor" },
  seats: { asc: "Butacas: menor a mayor", desc: "Butacas: mayor a menor" },
};

function updateSortButtons() {
  sortButtons.forEach((btn) => {
    const field = btn.dataset.sort;
    const isActive = field === listSort;
    const dir = isActive ? listSortDir : "asc";

    btn.classList.toggle("sort-toggle__btn--active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
    btn.querySelector("path").setAttribute("d", SORT_ICON_PATHS[field][dir]);
    btn.title = SORT_LABELS[field][dir];
    btn.setAttribute("aria-label", btn.title);
  });
}

async function saveSortPrefs() {
  await browser.storage.local.set({
    [SORT_KEY]: { field: listSort, dir: listSortDir },
  });
}

function loadSortPrefs(stored) {
  if (!stored) return;

  if (typeof stored === "string") {
    listSort = stored;
    listSortDir = "asc";
    return;
  }

  listSort = stored.field === "seats" ? "seats" : "expiry";
  listSortDir = stored.dir === "desc" ? "desc" : "asc";
}

function sortCodes(entries) {
  const sorted = [...entries];
  const dir = listSortDir === "asc" ? 1 : -1;

  if (listSort === "seats") {
    return sorted.sort((a, b) => {
      const seatsA = a.item.seats ?? 0;
      const seatsB = b.item.seats ?? 0;
      if (seatsA !== seatsB) return (seatsA - seatsB) * dir;
      return (a.daysRemaining - b.daysRemaining) * dir;
    });
  }

  return sorted.sort((a, b) => {
    if (a.daysRemaining !== b.daysRemaining) return (a.daysRemaining - b.daysRemaining) * dir;
    return ((a.item.seats ?? 0) - (b.item.seats ?? 0)) * dir;
  });
}

// ─── UI: tabs ───────────────────────────────────────────────────────────────

function activateTab(tabId, persistDraft = true) {
  activeTabId = tabId;
  tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === tabId;
    btn.classList.toggle("tabs__btn--active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  panels.forEach((panel) => {
    const show = panel.id === `panel-${tabId}`;
    panel.classList.toggle("panel--active", show);
    panel.hidden = !show;
  });
  if (persistDraft) saveFormDraft();
}

// ─── UI: rendering ──────────────────────────────────────────────────────────

function createMetaIcon(pathD, viewBox = "0 0 24 24") {
  const paths = Array.isArray(pathD) ? pathD : [pathD];
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("class", "card__meta-icon");
  svg.setAttribute("aria-hidden", "true");
  paths.forEach((d) => {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("d", d);
    svg.appendChild(path);
  });
  return svg;
}

function createMetaRow(iconSvg, text, className) {
  const row = document.createElement("span");
  row.className = `card__meta-row ${className}`;
  const label = document.createElement("span");
  label.textContent = text;
  row.append(iconSvg, label);
  return row;
}

const ICONS = {
  seat:
    "M5.35,5.64C4.45,5 4.23,3.76 4.86,2.85C5.5,1.95 6.74,1.73 7.65,2.36C8.55,3 8.77,4.24 8.14,5.15C7.5,6.05 6.26,6.27 5.35,5.64M16,19H8.93C7.45,19 6.19,17.92 5.97,16.46L4,7H2L4,16.76C4.37,19.2 6.47,21 8.94,21H16M16.23,15H11.35L10.32,10.9C11.9,11.79 13.6,12.44 15.47,12.12V10C13.84,10.3 12.03,9.72 10.78,8.74L9.14,7.47C8.91,7.29 8.65,7.17 8.38,7.09C8.06,7 7.72,6.97 7.39,7.03H7.37C6.14,7.25 5.32,8.42 5.53,9.64L6.88,15.56C7.16,17 8.39,18 9.83,18H16.68L20.5,21L22,19.5",
  play: "M8 5v14l11-7L8 5z",
  pause: "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
};

function createCard(item) {
  const daysRemaining = getDaysRemaining(item.expiresAt);
  const waiting = isWaitingForActivation(item);
  const urgency = getCardUrgency(daysRemaining, waiting);

  const card = document.createElement("article");
  card.className = ["card", urgency !== "normal" ? `card--${urgency}` : ""].join(" ").trim();

  const header = document.createElement("div");
  header.className = "card__header";

  const codeEl = document.createElement("p");
  codeEl.className = "card__code";
  codeEl.textContent = item.code;

  const dateEl = document.createElement("span");
  dateEl.className = "card__date";
  dateEl.textContent = formatReadableDate(item.createdAt);

  header.append(codeEl, dateEl);

  const meta = document.createElement("div");
  meta.className = "card__meta";

  const statusClasses = ["card__status", urgency !== "normal" ? `card__status--${urgency}` : ""].join(" ").trim();

  let statusText;
  if (waiting) {
    const daysUntil = getDaysUntilActivation(item);
    statusText =
      daysUntil === 0
        ? "Disponible hoy"
        : `Disponible en ${daysUntil} día${daysUntil === 1 ? "" : "s"}`;
  } else {
    statusText = `${daysRemaining} día${daysRemaining === 1 ? "" : "s"} restante${daysRemaining === 1 ? "" : "s"}`;
  }

  const statusEl = createMetaRow(
    createMetaIcon(waiting ? ICONS.pause : ICONS.play),
    statusText,
    statusClasses,
  );

  if (item.seats != null) {
    meta.append(
      createMetaRow(
        createMetaIcon(ICONS.seat),
        `${item.seats} butaca${item.seats === 1 ? "" : "s"}`,
        "card__seats",
      ),
      statusEl,
    );
  } else {
    meta.append(statusEl);
  }

  const actions = document.createElement("div");
  actions.className = "card__actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn--secondary btn--icon";
  copyBtn.title = waiting ? "Aún no disponible" : "Copiar código";
  copyBtn.textContent = "Copiar";
  copyBtn.disabled = waiting;
  if (!waiting) {
    copyBtn.addEventListener("click", () => copyCode(item.code, copyBtn));
  }

  const barcodeBtn = document.createElement("button");
  barcodeBtn.type = "button";
  barcodeBtn.className = "btn btn--secondary btn--icon";
  barcodeBtn.title = waiting ? "Aún no disponible" : "Mostrar código de barras";
  barcodeBtn.textContent = "Barras";
  barcodeBtn.disabled = waiting;
  if (!waiting) {
    barcodeBtn.addEventListener("click", () => openBarcodeOverlay(item.code));
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--danger btn--icon";
  deleteBtn.title = "Eliminar código";
  deleteBtn.textContent = "Eliminar";
  deleteBtn.addEventListener("click", async () => {
    await deleteCodeByValue(item.code);
    await renderList();
  });

  actions.append(copyBtn, barcodeBtn, deleteBtn);
  card.append(header, meta, actions);

  return card;
}

async function renderList() {
  const codes = await purgeExpired();
  codeList.innerHTML = "";

  if (codes.length === 0) {
    emptyList.hidden = false;
    return;
  }

  emptyList.hidden = true;

  const entries = codes.map((item) => ({
    item,
    daysRemaining: getDaysRemaining(item.expiresAt),
  }));

  sortCodes(entries).forEach(({ item }) => {
    codeList.appendChild(createCard(item));
  });
}

async function copyCode(code, button) {
  try {
    await navigator.clipboard.writeText(code);
    const originalText = button.textContent;
    button.textContent = "¡Copiado!";
    button.disabled = true;
    setTimeout(() => {
      button.textContent = originalText;
      button.disabled = false;
    }, 1500);
  } catch {
    button.textContent = "Error";
    setTimeout(() => {
      button.textContent = "Copiar";
    }, 1500);
  }
}

function showListMessage(text, type = "success") {
  listMessage.textContent = text;
  listMessage.className = `list-message list-message--${type}`;
  listMessage.hidden = false;
  setTimeout(() => {
    listMessage.hidden = true;
  }, 3000);
}

function normalizeImportedEntry(raw) {
  if (!raw || typeof raw.code !== "string") return null;

  const code = raw.code.trim();
  const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : "";
  const seats = Number.parseInt(raw.seats, 10);

  if (!code || !createdAt || !Number.isInteger(seats) || seats < 1) return null;
  if (isFutureDate(parseLocalDate(createdAt))) return null;

  const entry = {
    code,
    createdAt,
    expiresAt: typeof raw.expiresAt === "string" ? raw.expiresAt : addDays(createdAt, VALIDITY_DAYS),
    seats,
  };

  if (raw.pendingActivation) {
    entry.pendingActivation = true;
  }

  return entry;
}

function parseImportPayload(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.codes)) return data.codes;
  return null;
}

async function exportCodes() {
  if (!authSession) return;

  const codes = await getCodes();

  if (codes.length === 0) {
    showListMessage("No hay códigos para exportar.", "error");
    return;
  }

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    codes,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ucc-descuentos-${formatDateForInput(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);

  showListMessage(`${codes.length} código${codes.length === 1 ? "" : "s"} exportado${codes.length === 1 ? "" : "s"}.`);
}

async function importCodes(file) {
  if (!authSession) return;

  let data;

  try {
    data = JSON.parse(await file.text());
  } catch {
    showListMessage("El archivo no es un JSON válido.", "error");
    return;
  }

  const imported = parseImportPayload(data);

  if (!imported || imported.length === 0) {
    showListMessage("No se encontraron códigos en el archivo.", "error");
    return;
  }

  const existing = await getCodes();
  const existingCodes = new Set(existing.map((item) => item.code.trim()));
  const merged = [...existing];
  const newlyAdded = [];
  let added = 0;
  let skipped = 0;
  let invalid = 0;

  for (const raw of imported) {
    const entry = normalizeImportedEntry(raw);

    if (!entry) {
      invalid += 1;
      continue;
    }

    if (existingCodes.has(entry.code)) {
      skipped += 1;
      continue;
    }

    existingCodes.add(entry.code);
    merged.push(entry);
    newlyAdded.push(entry);
    added += 1;
  }

  if (added === 0) {
    const parts = [];
    if (skipped) parts.push(`${skipped} duplicado${skipped === 1 ? "" : "s"}`);
    if (invalid) parts.push(`${invalid} inválido${invalid === 1 ? "" : "s"}`);
    showListMessage(
      parts.length ? `No se importó nada (${parts.join(", ")}).` : "No se importó ningún código.",
      "error",
    );
    return;
  }

  await saveCodes(merged);
  try {
    for (const entry of newlyAdded) {
      await upsertRemoteCode(entry);
    }
  } catch {
    /* cache kept */
  }
  await renderList();

  const parts = [`${added} importado${added === 1 ? "" : "s"}`];
  if (skipped) parts.push(`${skipped} duplicado${skipped === 1 ? "" : "s"} omitido${skipped === 1 ? "" : "s"}`);
  if (invalid) parts.push(`${invalid} inválido${invalid === 1 ? "" : "s"}`);
  showListMessage(parts.join(". ") + ".");
}

function showFormMessage(text, type = "success") {
  formMessage.textContent = text;
  formMessage.className = `form-message form-message--${type}`;
  formMessage.hidden = false;
  setTimeout(() => {
    formMessage.hidden = true;
  }, 2500);
}

// ─── Auth / views ───────────────────────────────────────────────────────────

function showLoginMessage(text, type = "info") {
  loginMessage.textContent = text;
  loginMessage.className = `login-message login-message--${type}`;
  loginMessage.hidden = false;
}

function hideLoginMessage() {
  loginMessage.hidden = true;
}

function showView(name) {
  const isApp = name === "app";
  viewLogin.hidden = isApp;
  viewApp.hidden = !isApp;
}

async function clearCodesCache() {
  await browser.storage.local.remove([STORAGE_KEY, DRAFT_KEY]);
}

function displayNameFromEmail(email) {
  if (!email) return "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

function updateAuthChrome() {
  authEmail.textContent = displayNameFromEmail(authSession?.email);
  authEmail.title = authSession?.email || "";
  loginBtn.disabled = false;
  logoutBtn.disabled = false;
}

async function enterApp() {
  showView("app");
  updateAuthChrome();
  updateSortButtons();
  await loadFormDraft();
  try {
    await syncCodesWithCloud(getCodes, saveCodes);
  } catch {
    /* use session cache */
  }
  await renderList();
}

async function leaveApp() {
  await signOut();
  authSession = null;
  await clearCodesCache();
  codeList.innerHTML = "";
  clearForm();
  showView("login");
  updateAuthChrome();
  hideLoginMessage();
}

async function refreshAuthState() {
  authSession = await getValidSession();
  updateAuthChrome();
}

loginBtn.addEventListener("click", async () => {
  loginBtn.disabled = true;
  showLoginMessage("Completa el login en la ventana de Google…");
  try {
    authSession = await signInWithGoogle();
    hideLoginMessage();
    await enterApp();
    showListMessage("Sincronizado con tu cuenta.");
  } catch (err) {
    console.error(err);
    await refreshAuthState();
    if (authSession) {
      hideLoginMessage();
      await enterApp();
      showListMessage("Sincronizado con tu cuenta.");
      return;
    }
    const msg = String(err?.message || err);
    if (msg.includes("redirect") || msg.includes("invalid_request") || msg.includes("400")) {
      const uri = await getAuthRedirectUri();
      showLoginMessage(`URI OAuth (Google Cloud): ${uri}`, "error");
    } else if (msg === "User cancelled" || msg.includes("canceled") || msg.includes("cancelled")) {
      showLoginMessage("Inicio de sesión cancelado.", "error");
    } else {
      showLoginMessage("Si cerraste el popup, vuelve a abrirlo tras el login.", "error");
    }
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await leaveApp();
  } finally {
    logoutBtn.disabled = false;
  }
});

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.authSession) return;
  const next = changes.authSession.newValue || null;
  if (next?.idToken && !authSession) {
    authSession = await getValidSession();
    if (authSession) await enterApp();
  } else if (!next && authSession) {
    authSession = null;
    await clearCodesCache();
    showView("login");
    updateAuthChrome();
  }
});

// ─── Events ─────────────────────────────────────────────────────────────────

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    toggleCalendar(false);
    activateTab(btn.dataset.tab);
  });
});

sortButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    const field = btn.dataset.sort;

    if (listSort === field) {
      listSortDir = listSortDir === "asc" ? "desc" : "asc";
    } else {
      listSort = field;
      listSortDir = "asc";
    }

    updateSortButtons();
    await saveSortPrefs();
    await renderList();
  });
});

exportBtn.addEventListener("click", exportCodes);

importBtn.addEventListener("click", () => {
  importInput.click();
});

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  importInput.value = "";
  if (file) await importCodes(file);
});

codeInput.addEventListener("input", () => {
  saveFormDraft();
  scheduleValidation();
});

seatsInput.addEventListener("input", () => {
  sanitizeSeatsInput();
  updateValidationUI();
  saveFormDraft();
});

seatsInput.addEventListener("paste", (e) => {
  e.preventDefault();
  const pasted = (e.clipboardData || window.clipboardData).getData("text");
  seatsInput.value = pasted.replace(/\D/g, "");
  updateValidationUI();
  saveFormDraft();
});

window.addEventListener("pagehide", () => {
  if (authSession) saveFormDraft();
});

dateTrigger.addEventListener("click", () => toggleCalendar());

datePrev.addEventListener("click", () => {
  visibleMonth.month -= 1;
  if (visibleMonth.month < 0) {
    visibleMonth.month = 11;
    visibleMonth.year -= 1;
  }
  renderCalendar();
});

dateNext.addEventListener("click", () => {
  if (!canGoToNextMonth()) return;
  visibleMonth.month += 1;
  if (visibleMonth.month > 11) {
    visibleMonth.month = 0;
    visibleMonth.year += 1;
  }
  renderCalendar();
});

dateToday.addEventListener("click", () => {
  setDate(new Date());
  toggleCalendar(false);
});

clearFormBtn.addEventListener("click", clearForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!authSession) return;

  const code = codeInput.value.trim();
  const createdAt = getSelectedDate();
  const seats = Number.parseInt(seatsInput.value, 10);

  if (!code) {
    showFormMessage("Introduce un código de descuento.", "error");
    codeInput.focus();
    return;
  }

  if (!isSavableStatus(validationState.status) || validationState.code !== code) {
    const result = await validateCodeInput(code);
    if (!result || !isSavableStatus(result.status)) {
      showFormMessage("El código no es válido o ha caducado.", "error");
      codeInput.focus();
      return;
    }
  }

  if (!Number.isInteger(seats) || seats < 1) {
    showFormMessage("Introduce un número válido de butacas (mínimo 1).", "error");
    seatsInput.focus();
    return;
  }

  if (isFutureDate(selectedDate)) {
    showFormMessage("La fecha de creación no puede ser futura.", "error");
    return;
  }

  if (await codeExists(code)) {
    showFormMessage("Este código ya está guardado.", "error");
    codeInput.focus();
    return;
  }

  const pendingActivation = validationState.status === "not_yet_valid";
  const saved = await saveCode(code, createdAt, seats, pendingActivation);
  if (!saved) {
    showFormMessage("Este código ya está guardado.", "error");
    codeInput.focus();
    return;
  }
  await renderList();

  codeInput.value = "";
  seatsInput.value = "";
  resetValidation(true);
  initDate();
  await clearFormDraft();
  showFormMessage("Código guardado correctamente.");
  activateTab("list");
});

// ─── Init ───────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await refreshAuthState();
  if (authSession) {
    await enterApp();
  } else {
    await clearCodesCache();
    showView("login");
  }
});
