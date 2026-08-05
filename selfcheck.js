/**
 * Self-check: remote membership sync (local wins fields). Run: node selfcheck.js
 */
function mergeRemoteMembership(local, remote) {
  const localMap = new Map(local.map((i) => [i.code.trim(), i]));
  return remote.map((r) => localMap.get(r.code.trim()) || r);
}

function mergeRemoteTickets(local, remote) {
  const localMap = new Map(local.map((i) => [i.accessCode.trim(), i]));
  return remote.map((r) => localMap.get(r.accessCode.trim()) || r);
}

function ticketToFields(ticket) {
  return {
    accessCode: { stringValue: ticket.accessCode },
    referencia: { stringValue: ticket.referencia || "" },
    title: { stringValue: ticket.title || "" },
    showtime: { stringValue: ticket.showtime || "" },
    cinema: { stringValue: ticket.cinema || "" },
    seatsText: { stringValue: ticket.seatsText || "" },
    qrDataUrl: { stringValue: ticket.qrDataUrl || "" },
    barcodeDataUrl: { stringValue: ticket.barcodeDataUrl || "" },
    savedAt: { stringValue: ticket.savedAt || "" },
  };
}

function fieldsToTicket(fields) {
  if (!fields?.accessCode?.stringValue) return null;
  return {
    accessCode: fields.accessCode.stringValue,
    referencia: fields.referencia?.stringValue || "",
    title: fields.title?.stringValue || "",
    showtime: fields.showtime?.stringValue || "",
    cinema: fields.cinema?.stringValue || "",
    seatsText: fields.seatsText?.stringValue || "",
    qrDataUrl: fields.qrDataUrl?.stringValue || "",
    barcodeDataUrl: fields.barcodeDataUrl?.stringValue || "",
    savedAt: fields.savedAt?.stringValue || "",
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const remote = [
  { code: "111", seats: 1, createdAt: "2026-01-01" },
  { code: "222", seats: 2, createdAt: "2026-01-02" },
];
const local = [
  { code: "222", seats: 4, createdAt: "2026-01-03" },
  { code: "333", seats: 3, createdAt: "2026-01-04" },
];

const merged = mergeRemoteMembership(local, remote);
const byCode = Object.fromEntries(merged.map((c) => [c.code, c]));

assert(merged.length === 2, "expected 2 codes (remote membership)");
assert(byCode["111"].seats === 1, "remote-only code kept");
assert(byCode["222"].seats === 4, "local wins on conflict");
assert(!byCode["333"], "local-only code dropped (treated as deleted elsewhere)");

const emptyRemote = mergeRemoteMembership(local, []);
assert(emptyRemote.length === 0, "empty remote clears local (no migrate)");

const ticketSample = {
  accessCode: "2100079266074",
  referencia: "183410766332",
  title: "EL DIA DE LA REVELACION",
  showtime: "17/06/2026 - 19:30 - Sala 3",
  cinema: "Metromar Cinemas",
  seatsText: "Fila 6 Butaca 11; Fila 6 Butaca 13",
  qrDataUrl: "data:image/png;base64,qq",
  barcodeDataUrl: "data:image/png;base64,bb",
  savedAt: "2026-06-17T18:00:00.000Z",
};
const roundtrip = fieldsToTicket(ticketToFields(ticketSample));
assert(roundtrip.accessCode === ticketSample.accessCode, "ticket accessCode roundtrip");
assert(roundtrip.qrDataUrl === ticketSample.qrDataUrl, "ticket qrDataUrl roundtrip");
assert(roundtrip.barcodeDataUrl === ticketSample.barcodeDataUrl, "ticket barcodeDataUrl roundtrip");
assert(roundtrip.title === ticketSample.title, "ticket title roundtrip");

const remoteTickets = [
  { accessCode: "aaa", title: "A", savedAt: "1" },
  { accessCode: "bbb", title: "B-remote", savedAt: "2" },
];
const localTickets = [
  { accessCode: "bbb", title: "B-local", savedAt: "3" },
  { accessCode: "ccc", title: "C", savedAt: "4" },
];
const mergedTickets = mergeRemoteTickets(localTickets, remoteTickets);
const byAccess = Object.fromEntries(mergedTickets.map((t) => [t.accessCode, t]));
assert(mergedTickets.length === 2, "expected 2 tickets (remote membership)");
assert(byAccess.aaa.title === "A", "remote-only ticket kept");
assert(byAccess.bbb.title === "B-local", "local wins ticket fields");
assert(!byAccess.ccc, "local-only ticket dropped");

function parseValidationResult(body) {
  const message = typeof body === "string" ? body : String(body);
  if (message.includes("han pasado más de 60 días")) return { status: "expired" };
  if (message.includes("24 horas después de la compra")) return { status: "not_yet_valid" };
  if (message.includes("ya se han canjeado todas las butacas")) return { status: "seats_redeemed" };
  if (message.includes("La referencia no es válida")) return { status: "invalid" };
  return { status: "valid" };
}

assert(parseValidationResult("ok").status === "valid", "valid status");
assert(parseValidationResult("han pasado más de 60 días").status === "expired", "expired status");
assert(
  parseValidationResult("24 horas después de la compra").status === "not_yet_valid",
  "not_yet_valid status",
);

function parseEntradaHtml(html, referencia) {
  const text = String(html).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const accessFromText = (text.match(/C[oó]digo de barras:\s*(\d+)/i) || [])[1] || "";
  const qrSrc = (html.match(/src="(\/qrcode\/\?Codigo=\d+)"/i) || [])[1] || "";
  const codigoFromSrc = (qrSrc.match(/Codigo=(\d+)/i) || [])[1] || "";
  const accessCode = String(accessFromText || codigoFromSrc).trim();
  const posterAlt = (html.match(/alt="([^"]*)"[^>]*src="\/Carteles\//i) ||
    html.match(/src="\/Carteles\/[^"]+"[^>]*alt="([^"]*)"/i) ||
    [])[1];
  return {
    accessCode,
    referencia: referencia || "",
    title: (posterAlt || "").trim(),
    qrPath: qrSrc,
  };
}

const sampleHtml = `
<img src="/Carteles/x.jpg" alt="EL DIA DE LA REVELACION" />
<img src="/qrcode/?Codigo=2100079266074">
<img src="/codbarras/result.php?Codigo=2100079266074">
Código de barras: 2100079266074
`;
const parsed = parseEntradaHtml(sampleHtml, "183410766332");
assert(parsed.accessCode === "2100079266074", "parse accessCode");
assert(parsed.title === "EL DIA DE LA REVELACION", "parse title from alt");
assert(parsed.qrPath.includes("Codigo=2100079266074"), "parse qr path");

function isShowtimePast(showtime, today = new Date()) {
  const m = String(showtime || "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return false;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  d.setHours(0, 0, 0, 0);
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  return d < t;
}

const refDay = new Date(2026, 7, 5); // 5 Aug 2026
assert(isShowtimePast("04/08/2026 - 19:30", refDay), "past showtime skipped");
assert(!isShowtimePast("05/08/2026 - 19:30", refDay), "today showtime kept");
assert(!isShowtimePast("06/08/2026 - 19:30", refDay), "future showtime kept");
assert(!isShowtimePast("", refDay), "empty showtime not skipped");

console.log("selfcheck ok");
