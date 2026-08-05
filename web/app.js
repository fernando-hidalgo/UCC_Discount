import {
  watchAuth,
  signInWithGoogle,
  completeRedirectSignIn,
  signOut,
  upsertCode,
  deleteCodeRemote,
  syncCodes,
} from "./firebase.js";

const VALIDITY_DAYS = 59;
const WARNING_DAYS = 5;
const CRITICAL_DAYS = 2;
const ACTIVATION_WAIT_DAYS = 2;
const CACHE_KEY = "ucc_codes_cache";
const SORT_KEY = "ucc_list_sort";

const viewLogin = document.getElementById("view-login");
const viewApp = document.getElementById("view-app");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const loginMessage = document.getElementById("login-message");
const authEmail = document.getElementById("auth-email");
const tabButtons = document.querySelectorAll(".tabs__btn");
const panels = document.querySelectorAll(".panel");
const form = document.getElementById("code-form");
const codeInput = document.getElementById("code-input");
const seatsInput = document.getElementById("seats-input");
const dateInput = document.getElementById("date-input");
const submitBtn = document.getElementById("submit-btn");
const clearFormBtn = document.getElementById("clear-form-btn");
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

let user = null;
let codes = [];
let listSort = "expiry";
let listSortDir = "asc";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function showView(name) {
  const isApp = name === "app";
  viewLogin.hidden = isApp;
  viewApp.hidden = !isApp;
}

function displayName(email) {
  if (!email) return "";
  const at = email.indexOf("@");
  return at === -1 ? email : email.slice(0, at);
}

function showLoginMessage(text, type = "info") {
  loginMessage.textContent = text;
  loginMessage.className = `login-message login-message--${type}`;
  loginMessage.hidden = false;
}

function hideLoginMessage() {
  loginMessage.hidden = true;
}

function showListMessage(text, type = "success") {
  listMessage.textContent = text;
  listMessage.className = `list-message list-message--${type}`;
  listMessage.hidden = false;
  setTimeout(() => {
    listMessage.hidden = true;
  }, 3000);
}

function showFormMessage(text, type = "success") {
  formMessage.textContent = text;
  formMessage.className = `form-message form-message--${type}`;
  formMessage.hidden = false;
  setTimeout(() => {
    formMessage.hidden = true;
  }, 2500);
}

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

function getToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
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

function getDaysSince(dateStr) {
  return Math.floor((getToday() - parseLocalDate(dateStr)) / MS_PER_DAY);
}

function getDaysRemaining(expiresAt) {
  return Math.floor((parseLocalDate(expiresAt) - getToday()) / MS_PER_DAY);
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

function loadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCache(list) {
  codes = list;
  sessionStorage.setItem(CACHE_KEY, JSON.stringify(list));
}

function clearCache() {
  codes = [];
  sessionStorage.removeItem(CACHE_KEY);
}

function loadSort() {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    listSort = stored.field === "seats" ? "seats" : "expiry";
    listSortDir = stored.dir === "desc" ? "desc" : "asc";
  } catch {
    /* ignore */
  }
}

function saveSort() {
  localStorage.setItem(SORT_KEY, JSON.stringify({ field: listSort, dir: listSortDir }));
}

function activateTab(tabId) {
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
}

const SORT_ARROW_PATHS = {
  asc: "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
  desc: "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z",
};

const SORT_LABELS = {
  expiry: { asc: "Caducidad: menor a mayor", desc: "Caducidad: mayor a menor" },
  seats: { asc: "Butacas: menor a mayor", desc: "Butacas: mayor a menor" },
};

function updateSortButtons() {
  sortButtons.forEach((btn) => {
    const field = btn.dataset.sort;
    const active = field === listSort;
    const dir = active ? listSortDir : "asc";
    const arrowPath = btn.querySelector(".sort-toggle__arrow path");

    btn.classList.toggle("sort-toggle__btn--active", active);
    btn.setAttribute("aria-pressed", String(active));
    btn.title = SORT_LABELS[field][dir];
    btn.setAttribute("aria-label", btn.title);
    if (arrowPath) arrowPath.setAttribute("d", SORT_ARROW_PATHS[dir]);
  });
}

function sortEntries(entries) {
  const sorted = [...entries];
  const dir = listSortDir === "asc" ? 1 : -1;
  if (listSort === "seats") {
    return sorted.sort((a, b) => {
      if (a.item.seats !== b.item.seats) return (a.item.seats - b.item.seats) * dir;
      return (a.daysRemaining - b.daysRemaining) * dir;
    });
  }
  return sorted.sort((a, b) => {
    if (a.daysRemaining !== b.daysRemaining) return (a.daysRemaining - b.daysRemaining) * dir;
    return (a.item.seats - b.item.seats) * dir;
  });
}

function activateReady(list) {
  return list.map((item) => {
    if (item.pendingActivation && getDaysSince(item.createdAt) >= ACTIVATION_WAIT_DAYS) {
      const { pendingActivation, ...rest } = item;
      return rest;
    }
    return item;
  });
}

function purgeExpired(list) {
  return activateReady(list.filter((item) => getDaysRemaining(item.expiresAt) > 0));
}

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
      daysUntil === 0 ? "Disponible hoy" : `Disponible en ${daysUntil} día${daysUntil === 1 ? "" : "s"}`;
  } else {
    statusText = `${daysRemaining} día${daysRemaining === 1 ? "" : "s"} restante${daysRemaining === 1 ? "" : "s"}`;
  }
  const statusEl = createMetaRow(
    createMetaIcon(waiting ? ICONS.pause : ICONS.play),
    statusText,
    statusClasses,
  );
  meta.append(
    createMetaRow(
      createMetaIcon(ICONS.seat),
      `${item.seats} butaca${item.seats === 1 ? "" : "s"}`,
      "card__seats",
    ),
    statusEl,
  );

  const actions = document.createElement("div");
  actions.className = "card__actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "btn btn--secondary btn--icon";
  copyBtn.title = waiting ? "Aún no disponible" : "Copiar código";
  copyBtn.textContent = "Copiar";
  copyBtn.disabled = waiting;
  if (!waiting) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.code);
        copyBtn.textContent = "¡Copiado!";
        copyBtn.disabled = true;
        setTimeout(() => {
          copyBtn.textContent = "Copiar";
          copyBtn.disabled = false;
        }, 1500);
      } catch {
        copyBtn.textContent = "Error";
      }
    });
  }

  const barcodeBtn = document.createElement("button");
  barcodeBtn.type = "button";
  barcodeBtn.className = "btn btn--secondary btn--icon";
  barcodeBtn.title = waiting ? "Aún no disponible" : "Mostrar código de barras";
  barcodeBtn.textContent = "Barras";
  barcodeBtn.disabled = waiting;
  if (!waiting) {
    barcodeBtn.addEventListener("click", () => {
      barcodeOverlaySvg.innerHTML = renderBarcodeSvg(item.code);
      barcodeOverlay.hidden = false;
    });
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--danger btn--icon";
  deleteBtn.title = "Eliminar código";
  deleteBtn.textContent = "Eliminar";
  deleteBtn.addEventListener("click", async () => {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "…";
    try {
      await deleteCodeRemote(user.uid, item.code);
      saveCache(codes.filter((c) => c.code !== item.code));
      renderList();
    } catch (err) {
      console.error(err);
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Eliminar";
      showListMessage("No se pudo borrar en la nube.", "error");
    }
  });

  actions.append(copyBtn, barcodeBtn, deleteBtn);
  card.append(header, meta, actions);
  return card;
}

function renderList() {
  const active = purgeExpired(codes);
  if (active.length !== codes.length) saveCache(active);

  codeList.innerHTML = "";
  if (active.length === 0) {
    emptyList.hidden = false;
    return;
  }
  emptyList.hidden = true;

  const entries = active.map((item) => ({
    item,
    daysRemaining: getDaysRemaining(item.expiresAt),
  }));

  sortEntries(entries).forEach(({ item }) => {
    codeList.appendChild(createCard(item));
  });
}

function clearForm() {
  codeInput.value = "";
  seatsInput.value = "";
  dateInput.value = formatDateForInput(new Date());
  updateSubmit();
}

function updateSubmit() {
  const seats = Number.parseInt(seatsInput.value, 10);
  const ok =
    codeInput.value.trim().length > 0 &&
    Number.isInteger(seats) &&
    seats >= 1 &&
    Boolean(dateInput.value);
  submitBtn.disabled = !ok;
}

async function syncFromCloud() {
  const local = loadCache();
  const merged = await syncCodes(user.uid, local);
  const cleaned = purgeExpired(merged);
  saveCache(cleaned);
  renderList();
}

async function enterApp(authUser) {
  user = authUser;
  authEmail.textContent = displayName(authUser.email);
  authEmail.title = authUser.email || "";
  showView("app");
  loadSort();
  updateSortButtons();
  dateInput.value = formatDateForInput(new Date());
  dateInput.max = formatDateForInput(new Date());
  updateSubmit();
  try {
    await syncFromCloud();
  } catch (err) {
    console.error(err);
    codes = purgeExpired(loadCache());
    renderList();
    showListMessage("Usando cache local; no se pudo sync.", "error");
  }
}

function leaveApp() {
  user = null;
  clearCache();
  codeList.innerHTML = "";
  clearForm();
  showView("login");
  hideLoginMessage();
}

loginBtn.addEventListener("click", async () => {
  loginBtn.disabled = true;
  showLoginMessage("Abriendo Google…");
  try {
    await signInWithGoogle();
    // Popup resolves here; redirect navigates away. onAuthStateChanged opens app.
  } catch (err) {
    console.error(err);
    showLoginMessage(err?.message || "No se pudo iniciar sesión.", "error");
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    await signOut();
    leaveApp();
  } finally {
    logoutBtn.disabled = false;
  }
});

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});

sortButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const field = btn.dataset.sort;
    if (listSort === field) {
      listSortDir = listSortDir === "asc" ? "desc" : "asc";
    } else {
      listSort = field;
      listSortDir = "asc";
    }
    saveSort();
    updateSortButtons();
    renderList();
  });
});

codeInput.addEventListener("input", updateSubmit);
seatsInput.addEventListener("input", () => {
  seatsInput.value = seatsInput.value.replace(/\D/g, "");
  updateSubmit();
});
dateInput.addEventListener("change", updateSubmit);
clearFormBtn.addEventListener("click", clearForm);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!user) return;

  const code = codeInput.value.trim();
  const createdAt = dateInput.value;
  const seats = Number.parseInt(seatsInput.value, 10);

  if (!code || !createdAt || !Number.isInteger(seats) || seats < 1) {
    showFormMessage("Revisa código, butacas y fecha.", "error");
    return;
  }
  if (parseLocalDate(createdAt) > getToday()) {
    showFormMessage("La fecha no puede ser futura.", "error");
    return;
  }
  if (codes.some((c) => c.code === code)) {
    showFormMessage("Este código ya está guardado.", "error");
    return;
  }

  const entry = {
    code,
    createdAt,
    expiresAt: addDays(createdAt, VALIDITY_DAYS),
    seats,
  };

  const next = [...codes, entry];
  saveCache(next);
  renderList();
  clearForm();
  activateTab("list");
  showFormMessage("Código guardado.");

  try {
    await upsertCode(user.uid, entry);
  } catch (err) {
    console.error(err);
    showListMessage("Guardado en cache; falló la nube.", "error");
  }
});

exportBtn.addEventListener("click", () => {
  if (!user || codes.length === 0) {
    showListMessage("No hay códigos para exportar.", "error");
    return;
  }
  const payload = { version: 1, exportedAt: new Date().toISOString(), codes };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ucc-descuentos-${formatDateForInput(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showListMessage(`${codes.length} exportado${codes.length === 1 ? "" : "s"}.`);
});

importBtn.addEventListener("click", () => importInput.click());

importInput.addEventListener("change", async () => {
  const file = importInput.files?.[0];
  importInput.value = "";
  if (!file || !user) return;

  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    showListMessage("JSON inválido.", "error");
    return;
  }

  const imported = Array.isArray(data) ? data : data?.codes;
  if (!Array.isArray(imported) || imported.length === 0) {
    showListMessage("Sin códigos en el archivo.", "error");
    return;
  }

  const existing = new Set(codes.map((c) => c.code));
  const newly = [];
  for (const raw of imported) {
    if (!raw?.code || !raw.createdAt) continue;
    const seats = Number.parseInt(raw.seats, 10);
    if (!Number.isInteger(seats) || seats < 1) continue;
    const code = String(raw.code).trim();
    if (existing.has(code)) continue;
    existing.add(code);
    const entry = {
      code,
      createdAt: raw.createdAt,
      expiresAt: raw.expiresAt || addDays(raw.createdAt, VALIDITY_DAYS),
      seats,
    };
    if (raw.pendingActivation) entry.pendingActivation = true;
    newly.push(entry);
  }

  if (newly.length === 0) {
    showListMessage("Nada nuevo que importar.", "error");
    return;
  }

  const next = [...codes, ...newly];
  saveCache(next);
  renderList();
  showListMessage(`${newly.length} importado${newly.length === 1 ? "" : "s"}.`);
  try {
    for (const entry of newly) await upsertCode(user.uid, entry);
  } catch (err) {
    console.error(err);
    showListMessage("Import local OK; sync nube falló.", "error");
  }
});

barcodeOverlayClose.addEventListener("click", () => {
  barcodeOverlay.hidden = true;
  barcodeOverlaySvg.innerHTML = "";
});
barcodeOverlay.addEventListener("click", (e) => {
  if (e.target === barcodeOverlay) {
    barcodeOverlay.hidden = true;
    barcodeOverlaySvg.innerHTML = "";
  }
});

let authReady = false;

showLoginMessage("Comprobando sesión…");

(async () => {
  try {
    await completeRedirectSignIn();
  } catch (err) {
    console.error(err);
    showLoginMessage(err?.message || "Error al completar el login.", "error");
  } finally {
    authReady = true;
  }

  watchAuth(async (authUser) => {
    if (!authReady && !authUser) return;
    hideLoginMessage();
    loginBtn.disabled = false;
    if (authUser) {
      await enterApp(authUser);
    } else if (authReady) {
      leaveApp();
    }
  });
})();
