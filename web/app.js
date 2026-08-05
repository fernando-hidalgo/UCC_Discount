import {
  watchAuth,
  signInWithGoogle,
  completeRedirectSignIn,
  signOut,
  upsertCode,
  deleteCodeRemote,
  syncCodes,
  deleteTicketRemote,
  syncTickets,
  upsertTicket,
  validateCodeRemote,
  fetchEntradaRemote,
} from "./firebase.js";
import { readTicketImage } from "./ocr.js";

const VALIDITY_DAYS = 59;
const WARNING_DAYS = 5;
const CRITICAL_DAYS = 2;
const ACTIVATION_WAIT_DAYS = 2;
const VALIDATION_DEBOUNCE_MS = 500;
const CACHE_KEY = "ucc_codes_cache";
const TICKETS_CACHE_KEY = "ucc_tickets_cache";
const SORT_KEY = "ucc_list_sort";
const TICKET_SORT_KEY = "ucc_ticket_sort";

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
const codeValidation = document.getElementById("code-validation");
const seatsInput = document.getElementById("seats-input");
const dateInput = document.getElementById("date-input");
const submitBtn = document.getElementById("submit-btn");
const clearFormBtn = document.getElementById("clear-form-btn");
const addCodeBtn = document.getElementById("add-code-btn");
const ocrScan = document.getElementById("ocr-scan");
const ocrScanBtn = document.getElementById("ocr-scan-btn");
const ocrScanLabel = document.getElementById("ocr-scan-label");
const ocrFileInput = document.getElementById("ocr-file-input");
const ocrStatus = document.getElementById("ocr-status");
const ocrStatusRow = document.getElementById("ocr-status-row");
const ocrThumb = document.getElementById("ocr-thumb");
const ocrResultText = document.getElementById("ocr-result-text");
const ocrChangeBtn = document.getElementById("ocr-change-btn");
let ocrObjectUrl = "";
const codeList = document.getElementById("code-list");
const emptyList = document.getElementById("empty-list");
const ticketList = document.getElementById("ticket-list");
const emptyTickets = document.getElementById("empty-tickets");
const ticketsMessage = document.getElementById("tickets-message");
const sortButtons = document.querySelectorAll("#panel-list .sort-toggle__btn[data-sort]");
const ticketSortBtn = document.getElementById("ticket-sort-btn");
const listMessage = document.getElementById("list-message");
const formMessage = document.getElementById("form-message");
const barcodeOverlay = document.getElementById("barcode-overlay");
const barcodeOverlaySvg = document.getElementById("barcode-overlay-svg");
const barcodeOverlayClose = document.getElementById("barcode-overlay-close");
const ticketOverlay = document.getElementById("ticket-overlay");
const ticketOverlayClose = document.getElementById("ticket-overlay-close");
const ticketOverlayTitle = document.getElementById("ticket-overlay-title");
const ticketOverlayQr = document.getElementById("ticket-overlay-qr");
const ticketOverlayBarcode = document.getElementById("ticket-overlay-barcode");

let user = null;
let codes = [];
let tickets = [];
let listSort = "expiry";
let listSortDir = "asc";
let ticketSortDir = "asc";
let validationState = { status: "idle", code: "" };
let validationRequestId = 0;
let validationDebounceTimer = null;
let submitBusy = false;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function setBarcodeOverlaySvg(code) {
  barcodeOverlaySvg.replaceChildren();
  const doc = new DOMParser().parseFromString(renderBarcodeSvg(code), "image/svg+xml");
  const svg = doc.documentElement;
  if (svg?.nodeName === "svg" && !doc.querySelector("parsererror")) {
    barcodeOverlaySvg.appendChild(document.importNode(svg, true));
  }
}

function openBarcodeOverlay(code) {
  setBarcodeOverlaySvg(code);
  barcodeOverlay.hidden = false;
}

function closeBarcodeOverlay() {
  if (barcodeOverlay.hidden) return;
  barcodeOverlay.hidden = true;
  barcodeOverlaySvg.replaceChildren();
}

let loginBgTimer = null;

function stopLoginBgWander() {
  if (loginBgTimer != null) {
    clearTimeout(loginBgTimer);
    loginBgTimer = null;
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scheduleLoginBgWander() {
  stopLoginBgWander();
  if (!viewLogin || viewLogin.hidden || prefersReducedMotion()) return;

  const x = 5 + Math.random() * 90;
  const y = 5 + Math.random() * 90;
  const dur = 3.5 + Math.random() * 3;
  viewLogin.style.transition = `background-position ${dur.toFixed(1)}s ease-in-out`;
  viewLogin.style.backgroundPosition = `${x.toFixed(1)}% ${y.toFixed(1)}%`;
  loginBgTimer = setTimeout(scheduleLoginBgWander, dur * 1000);
}

function showView(name) {
  const isApp = name === "app";
  viewLogin.hidden = isApp;
  viewApp.hidden = !isApp;
  document.body.classList.toggle("is-login", !isApp);
  document.documentElement.classList.toggle("is-login", !isApp);
  if (isApp) {
    stopLoginBgWander();
  } else {
    scheduleLoginBgWander();
  }
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

function showTicketsMessage(text, type = "success") {
  ticketsMessage.textContent = text;
  ticketsMessage.className = `list-message list-message--${type}`;
  ticketsMessage.hidden = false;
  setTimeout(() => {
    ticketsMessage.hidden = true;
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

/** Showtime from compraentradas: "17/06/2026 - 19:30 - Sala 3". */
function parseShowtimeDate(showtime) {
  const m = String(showtime || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isShowtimePast(showtime) {
  const d = parseShowtimeDate(showtime);
  if (!d) return false;
  d.setHours(0, 0, 0, 0);
  return d < getToday();
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

function loadTicketsCache() {
  try {
    const raw = sessionStorage.getItem(TICKETS_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTicketsCache(list) {
  tickets = list;
  sessionStorage.setItem(TICKETS_CACHE_KEY, JSON.stringify(list));
}

function clearCache() {
  codes = [];
  tickets = [];
  sessionStorage.removeItem(CACHE_KEY);
  sessionStorage.removeItem(TICKETS_CACHE_KEY);
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

function loadTicketSort() {
  try {
    const raw = localStorage.getItem(TICKET_SORT_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    ticketSortDir = stored.dir === "desc" ? "desc" : "asc";
  } catch {
    /* ignore */
  }
}

function saveTicketSort() {
  localStorage.setItem(TICKET_SORT_KEY, JSON.stringify({ dir: ticketSortDir }));
}

function activateTab(tabId) {
  tabButtons.forEach((btn) => {
    const active = tabId !== "add" && btn.dataset.tab === tabId;
    btn.classList.toggle("tabs__btn--active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  panels.forEach((panel) => {
    const show = panel.id === `panel-${tabId}`;
    panel.classList.toggle("panel--active", show);
    panel.hidden = !show;
  });
  addCodeBtn.hidden = tabId === "add";
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

const TICKET_SORT_LABELS = {
  asc: "Fecha: más próxima primero",
  desc: "Fecha: más lejana primero",
};

function updateTicketSortButton() {
  if (!ticketSortBtn) return;
  const arrowPath = ticketSortBtn.querySelector(".sort-toggle__arrow path");
  ticketSortBtn.title = TICKET_SORT_LABELS[ticketSortDir];
  ticketSortBtn.setAttribute("aria-label", ticketSortBtn.title);
  if (arrowPath) arrowPath.setAttribute("d", SORT_ARROW_PATHS[ticketSortDir]);
}

function ticketSortKey(ticket) {
  const d = parseShowtimeDate(ticket.showtime);
  if (d) return d.getTime();
  const saved = Date.parse(ticket.savedAt || "");
  return Number.isFinite(saved) ? saved : 0;
}

function sortTickets(list) {
  const dir = ticketSortDir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => (ticketSortKey(a) - ticketSortKey(b)) * dir);
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
  seat: "M4 18v3h3v-3h10v3h3v-6H4zm15-8h3v3h-3zM2 10h3v3H2zm15 3H7V5c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2z",
  clock:
    "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8zm.5-13H11v6l5.2 3.2.8-1.3-4.5-2.7V7z",
};

function openTicketOverlay(ticket) {
  ticketOverlayTitle.textContent = ticket.title || "Entrada";
  ticketOverlayQr.src = ticket.qrDataUrl || "";
  ticketOverlayBarcode.src = ticket.barcodeDataUrl || "";
  ticketOverlay.hidden = false;
  ticketOverlayClose.focus();
}

function closeTicketOverlay() {
  if (ticketOverlay.hidden) return;
  ticketOverlay.hidden = true;
  ticketOverlayQr.removeAttribute("src");
  ticketOverlayBarcode.removeAttribute("src");
}

function createTicketCard(ticket) {
  const card = document.createElement("article");
  card.className = "card";

  const header = document.createElement("div");
  header.className = "card__header";
  const title = document.createElement("h3");
  title.className = "card__code";
  title.textContent = ticket.title || ticket.accessCode || "Entrada";
  header.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "card__meta";
  if (ticket.showtime) {
    meta.appendChild(createMetaRow(createMetaIcon(ICONS.clock), ticket.showtime, "card__date"));
  }
  if (ticket.seatsText) {
    meta.appendChild(createMetaRow(createMetaIcon(ICONS.seat), ticket.seatsText, "card__seats"));
  }

  const actions = document.createElement("div");
  actions.className = "card__actions";

  const viewBtn = document.createElement("button");
  viewBtn.type = "button";
  viewBtn.className = "btn btn--secondary btn--icon";
  viewBtn.title = "Ver QR y barras";
  viewBtn.textContent = "Ver";
  viewBtn.addEventListener("click", () => openTicketOverlay(ticket));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--danger btn--icon";
  deleteBtn.title = "Eliminar entrada";
  deleteBtn.textContent = "Eliminar";
  deleteBtn.addEventListener("click", async () => {
    deleteBtn.disabled = true;
    deleteBtn.textContent = "…";
    try {
      await deleteTicketRemote(user.uid, ticket.accessCode);
      saveTicketsCache(tickets.filter((t) => t.accessCode !== ticket.accessCode));
      renderTickets();
    } catch (err) {
      console.error(err);
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Eliminar";
      showTicketsMessage("No se pudo borrar en la nube.", "error");
    }
  });

  actions.append(viewBtn, deleteBtn);
  card.append(header, meta, actions);
  return card;
}

function renderTickets() {
  ticketList.innerHTML = "";
  if (tickets.length === 0) {
    emptyTickets.hidden = false;
    return;
  }
  emptyTickets.hidden = true;
  sortTickets(tickets).forEach((ticket) => ticketList.appendChild(createTicketCard(ticket)));
}

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
    createMetaIcon(ICONS.clock),
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
    barcodeBtn.addEventListener("click", () => openBarcodeOverlay(item.code));
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
  validationRequestId += 1;
  clearTimeout(validationDebounceTimer);
  codeInput.value = "";
  seatsInput.value = "";
  dateInput.value = formatDateForInput(new Date());
  validationState = { status: "idle", code: "" };
  updateValidationUI();
  resetOcrUi();
}

function resetOcrUi() {
  setOcrCardState("idle");
  if (ocrScanLabel) ocrScanLabel.textContent = "Escanear";
  ocrStatus.hidden = true;
  ocrStatus.textContent = "";
  ocrStatus.className = "ocr-scan__status";
  if (ocrStatusRow) ocrStatusRow.hidden = true;
  if (ocrObjectUrl) {
    URL.revokeObjectURL(ocrObjectUrl);
    ocrObjectUrl = "";
  }
  if (ocrThumb) ocrThumb.removeAttribute("src");
  ocrFileInput.value = "";
  ocrScanBtn.disabled = false;
}

function setOcrCardState(state) {
  if (ocrScan) ocrScan.dataset.state = state;
  if (ocrStatusRow) {
    ocrStatusRow.hidden = state !== "done" && state !== "error";
  }
}

function setOcrStatus(text, isError = false) {
  ocrStatus.hidden = !text;
  ocrStatus.textContent = text || "";
  ocrStatus.className = `ocr-scan__status${isError ? " ocr-scan__status--error" : ""}`;
}

function ocrErrorMessage(err) {
  const code = err?.code || "";
  const msg = String(err?.message || "");
  if (code === "functions/unauthenticated" || /unauthenticated/i.test(msg)) {
    return "Inicia sesión de nuevo e inténtalo.";
  }
  if (code === "functions/permission-denied" || /OCR no habilitado|permiso/i.test(msg)) {
    return "OCR no disponible. Rellena a mano o prueba más tarde.";
  }
  if (code === "functions/failed-precondition") {
    return "No se pudo leer. Prueba otra foto.";
  }
  if (code === "functions/invalid-argument") {
    return msg.replace(/^Firebase:\s*/i, "").replace(/\s*\(.*\)\s*$/, "") || "Imagen no válida.";
  }
  if (code === "functions/internal" || /internal/i.test(code)) {
    return "No se pudo leer el ticket. Inténtalo de nuevo.";
  }
  if (/img_load|canvas|read_failed/i.test(msg)) {
    return "No se pudo procesar la foto. Prueba otra.";
  }
  return "No se pudo leer la imagen. Inténtalo de nuevo.";
}

async function handleOcrFile(file) {
  if (!file) return;
  ocrScanBtn.disabled = true;
  if (ocrScanLabel) ocrScanLabel.textContent = "Leyendo…";
  if (ocrObjectUrl) URL.revokeObjectURL(ocrObjectUrl);
  ocrObjectUrl = URL.createObjectURL(file);
  if (ocrThumb) ocrThumb.src = ocrObjectUrl;
  setOcrCardState("scanning");
  setOcrStatus("");

  try {
    const result = await readTicketImage(file);
    const missing = [];
    if (result.referencia) codeInput.value = result.referencia;
    else missing.push("referencia");
    if (result.seats) seatsInput.value = result.seats;
    else missing.push("butacas");
    if (result.createdAt) dateInput.value = result.createdAt;
    else missing.push("fecha");

    scheduleValidation();
    updateSubmit();

    if (missing.length === 3) {
      if (ocrResultText) ocrResultText.textContent = "Prueba otra foto o rellena a mano.";
      setOcrCardState("error");
      setOcrStatus("");
    } else if (missing.length) {
      if (ocrResultText) ocrResultText.textContent = `Falta: ${missing.join(", ")}`;
      setOcrCardState("error");
      setOcrStatus("");
    } else {
      if (ocrResultText) ocrResultText.textContent = "Código leído ✓";
      setOcrCardState("done");
      setOcrStatus("");
    }
  } catch (err) {
    console.error(err);
    if (ocrResultText) ocrResultText.textContent = ocrErrorMessage(err);
    setOcrCardState("error");
    setOcrStatus("");
  } finally {
    if (ocrScanLabel) ocrScanLabel.textContent = "Escanear";
    ocrScanBtn.disabled = false;
  }
}

function isSavableStatus(status) {
  return status === "valid" || status === "not_yet_valid";
}

function isFormComplete() {
  const seats = Number.parseInt(seatsInput.value, 10);
  return (
    codeInput.value.trim().length > 0 &&
    Number.isInteger(seats) &&
    seats >= 1 &&
    Boolean(dateInput.value)
  );
}

function setSubmitBusy(busy) {
  submitBusy = busy;
  submitBtn.classList.toggle("btn--busy", busy);
  if (busy) submitBtn.disabled = true;
  else updateValidationUI();
}

function updateValidationUI() {
  const code = codeInput.value.trim();
  codeInput.classList.remove("form__input--valid", "form__input--invalid", "form__input--pending");

  if (!code) {
    codeValidation.hidden = true;
    submitBtn.disabled = true;
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
    idle: "",
  };

  if (validationState.status === "idle") {
    codeValidation.hidden = true;
    submitBtn.disabled = true;
    return;
  }

  codeValidation.hidden = false;
  codeValidation.className = `code-validation code-validation--${validationState.status}`;
  codeValidation.textContent = labels[validationState.status] || "";

  if (validationState.status === "valid") {
    codeInput.classList.add("form__input--valid");
  } else if (validationState.status === "not_yet_valid") {
    codeInput.classList.add("form__input--pending");
  } else if (
    ["invalid", "expired", "seats_redeemed", "duplicate", "error"].includes(validationState.status)
  ) {
    codeInput.classList.add("form__input--invalid");
  }

  submitBtn.disabled =
    submitBusy ||
    !(
      isFormComplete() &&
      isSavableStatus(validationState.status) &&
      validationState.code === code
    );
}

async function validateCodeInput(code) {
  const requestId = ++validationRequestId;
  validationState = { status: "loading", code };
  updateValidationUI();

  try {
    if (codes.some((c) => c.code === code)) {
      if (requestId !== validationRequestId) return null;
      validationState = { status: "duplicate", code };
      updateValidationUI();
      return { status: "duplicate" };
    }
    const result = await validateCodeRemote(code);
    if (requestId !== validationRequestId) return null;
    validationState = { status: result.status, code };
    updateValidationUI();
    return result;
  } catch (err) {
    console.error(err);
    if (requestId !== validationRequestId) return null;
    validationState = { status: "error", code };
    updateValidationUI();
    return { status: "error" };
  }
}

function scheduleValidation() {
  clearTimeout(validationDebounceTimer);
  const code = codeInput.value.trim();
  if (!code) {
    validationState = { status: "idle", code: "" };
    updateValidationUI();
    return;
  }
  validationDebounceTimer = setTimeout(() => {
    validateCodeInput(code);
  }, VALIDATION_DEBOUNCE_MS);
}

function updateSubmit() {
  updateValidationUI();
}

async function syncFromCloud() {
  const local = loadCache();
  const merged = await syncCodes(user.uid, local);
  const cleaned = purgeExpired(merged);
  saveCache(cleaned);
  renderList();

  const localTickets = loadTicketsCache();
  const mergedTickets = await syncTickets(user.uid, localTickets);
  saveTicketsCache(mergedTickets);
  renderTickets();
}

async function enterApp(authUser) {
  user = authUser;
  authEmail.textContent = displayName(authUser.email);
  authEmail.title = authUser.email || "";
  showView("app");
  loadSort();
  loadTicketSort();
  updateSortButtons();
  updateTicketSortButton();
  dateInput.value = formatDateForInput(new Date());
  dateInput.max = formatDateForInput(new Date());
  updateSubmit();
  try {
    await syncFromCloud();
  } catch (err) {
    console.error(err);
    codes = purgeExpired(loadCache());
    tickets = loadTicketsCache();
    renderList();
    renderTickets();
    showListMessage("Usando cache local; no se pudo sync.", "error");
  }
}

function leaveApp() {
  user = null;
  clearCache();
  codeList.innerHTML = "";
  ticketList.innerHTML = "";
  closeTicketOverlay();
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

addCodeBtn.addEventListener("click", () => {
  activateTab("add");
  codeInput.focus();
});

ocrScanBtn.addEventListener("click", () => ocrFileInput.click());
ocrChangeBtn?.addEventListener("click", () => ocrFileInput.click());
ocrFileInput.addEventListener("change", () => {
  const file = ocrFileInput.files?.[0];
  if (file) handleOcrFile(file);
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

ticketSortBtn?.addEventListener("click", () => {
  ticketSortDir = ticketSortDir === "asc" ? "desc" : "asc";
  saveTicketSort();
  updateTicketSortButton();
  renderTickets();
});

codeInput.addEventListener("input", () => {
  scheduleValidation();
  updateSubmit();
});
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

  if (!isSavableStatus(validationState.status) || validationState.code !== code) {
    setSubmitBusy(true);
    const result = await validateCodeInput(code);
    if (!result || !isSavableStatus(result.status)) {
      showFormMessage("El código no es válido o ha caducado.", "error");
      setSubmitBusy(false);
      return;
    }
  }

  const pendingActivation = validationState.status === "not_yet_valid";
  const entry = {
    code,
    createdAt,
    expiresAt: addDays(createdAt, VALIDITY_DAYS),
    seats,
  };
  if (pendingActivation) entry.pendingActivation = true;

  setSubmitBusy(true);
  const next = [...codes, entry];
  saveCache(next);
  renderList();

  try {
    await upsertCode(user.uid, entry);
  } catch (err) {
    console.error(err);
    showListMessage("Guardado en cache; falló la nube.", "error");
  }

  let formMsg = "Código guardado.";
  try {
    const ticket = await fetchEntradaRemote(code);
    if (ticket?.found === false || !ticket?.accessCode) {
      /* code only */
    } else if (isShowtimePast(ticket.showtime)) {
      formMsg = "Código guardado; la sesión ya pasó, no se añadió la entrada.";
      showListMessage(formMsg, "error");
    } else {
      const exists = tickets.some((t) => t.accessCode === ticket.accessCode);
      await upsertTicket(user.uid, ticket);
      if (exists) {
        saveTicketsCache(
          tickets.map((t) => (t.accessCode === ticket.accessCode ? ticket : t)),
        );
      } else {
        saveTicketsCache([...tickets, ticket]);
      }
      renderTickets();
      formMsg = "Código y entrada guardados.";
    }
  } catch (err) {
    console.error(err);
    /* code already saved */
  }

  setSubmitBusy(false);
  clearForm();
  activateTab("list");
  showFormMessage(formMsg);
});

barcodeOverlayClose.addEventListener("click", closeBarcodeOverlay);
barcodeOverlay.addEventListener("click", (e) => {
  if (e.target === barcodeOverlay) closeBarcodeOverlay();
});

ticketOverlayClose.addEventListener("click", closeTicketOverlay);
ticketOverlay.addEventListener("click", (e) => {
  if (e.target === ticketOverlay) closeTicketOverlay();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeBarcodeOverlay();
  closeTicketOverlay();
});

let authReady = false;

showLoginMessage("Comprobando sesión…");
scheduleLoginBgWander();

const footerYear = document.getElementById("footer-year");
if (footerYear) footerYear.textContent = String(new Date().getFullYear());

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
