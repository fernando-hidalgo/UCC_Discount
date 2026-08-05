const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const VALIDATION_URL = "https://www.compraentradas.com/Sesion/VuelvePor5";
const ENTRADA_BASE = "https://www.compraentradas.com/Entrada";
const MSG_EXPIRED = "han pasado más de 60 días";
const MSG_NOT_YET = "24 horas después de la compra";
const MSG_SEATS_REDEEMED = "ya se han canjeado todas las butacas";
const MSG_INVALID = "La referencia no es válida";

function requireAuth(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Debes iniciar sesión.");
  }
}

function parseValidationResult(body) {
  const message = typeof body === "string" ? body : String(body);
  if (message.includes(MSG_EXPIRED)) return { status: "expired" };
  if (message.includes(MSG_NOT_YET)) return { status: "not_yet_valid" };
  if (message.includes(MSG_SEATS_REDEEMED)) return { status: "seats_redeemed" };
  if (message.includes(MSG_INVALID)) return { status: "invalid" };
  return { status: "valid" };
}

async function fetchValidationBody(code) {
  const url = `${VALIDATION_URL}?Referencia=${encodeURIComponent(code)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

async function blobToDataUrl(res) {
  const buf = Buffer.from(await res.arrayBuffer());
  const ctype = res.headers.get("content-type") || "image/png";
  return `data:${ctype};base64,${buf.toString("base64")}`;
}

function decodeHtml(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract ticket fields from compraentradas Entrada HTML. */
function parseEntradaHtml(html, referencia) {
  const text = decodeHtml(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "\n"));
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const accessFromText = (text.match(/C[oó]digo de barras:\s*(\d+)/i) || [])[1] || "";
  const qrSrc = (html.match(/src="(\/qrcode\/\?Codigo=\d+)"/i) || [])[1] || "";
  const barcodeSrc = (html.match(/src="(\/codbarras\/[^"]*Codigo=\d+[^"]*)"/i) || [])[1] || "";
  const codigoFromSrc = (qrSrc.match(/Codigo=(\d+)/i) || barcodeSrc.match(/Codigo=(\d+)/i) || [])[1] || "";
  const accessCode = String(accessFromText || codigoFromSrc).trim();

  const posterAlt = (html.match(/src="\/Carteles\/[^"]+"[^>]*alt="([^"]*)"/i) ||
    html.match(/alt="([^"]*)"[^>]*src="\/Carteles\//i) ||
    [])[1];
  let title = (posterAlt || "").trim();
  if (!title || /promoci/i.test(title)) {
    title =
      lines.find(
        (l) =>
          !/\d{2}\/\d{2}\/\d{4}/.test(l) &&
          !/butaca|entrada|total|cif|€|promoci|referencia|metromar|mendivil|mairena|cc\s|gracias|aviso|codigo/i.test(
            l,
          ),
      ) || title;
  }

  const showtime = lines.find((l) => /\d{2}\/\d{2}\/\d{4}/.test(l)) || "";
  const cinema = lines.find((l) => /cinemas/i.test(l)) || "";
  const seatsText = lines
    .filter((l) => /Butaca Fila/i.test(l))
    .map((l) => {
      const m = l.match(/Fila:\s*(\d+),\s*Butaca:\s*(\d+)/i);
      return m ? `Fila ${m[1]} Butaca ${m[2]}` : l;
    })
    .join("; ");

  const refFromPage = (text.match(/Referencia\s+(\d+)/i) || [])[1] || String(referencia || "");

  return {
    accessCode,
    referencia: refFromPage,
    title: title || "",
    showtime,
    cinema,
    seatsText,
    qrPath: qrSrc,
    barcodePath: barcodeSrc,
  };
}

exports.parseEntradaHtml = parseEntradaHtml;
exports.parseValidationResult = parseValidationResult;

exports.validateCode = onCall(async (request) => {
  requireAuth(request);
  const code = String(request.data?.code || "").trim();
  if (!code) throw new HttpsError("invalid-argument", "Falta el código.");
  try {
    const body = await fetchValidationBody(code);
    return parseValidationResult(body);
  } catch (err) {
    console.error("validateCode", err);
    throw new HttpsError("internal", "No se pudo validar el código.");
  }
});

exports.fetchEntrada = onCall(
  {
    timeoutSeconds: 60,
    memory: "256MiB",
  },
  async (request) => {
    requireAuth(request);
    const referencia = String(request.data?.referencia || "").trim();
    if (!/^\d+$/.test(referencia)) {
      throw new HttpsError("invalid-argument", "Referencia inválida.");
    }

    try {
      const pageRes = await fetch(`${ENTRADA_BASE}/${referencia}`, {
        headers: { Accept: "text/html" },
      });
      if (!pageRes.ok) {
        throw new HttpsError("not-found", `Entrada HTTP ${pageRes.status}`);
      }
      const html = await pageRes.text();
      const parsed = parseEntradaHtml(html, referencia);
      if (!parsed.accessCode || !parsed.qrPath || !parsed.barcodePath) {
        throw new HttpsError("failed-precondition", "No se encontraron QR/barras en la entrada.");
      }

      const [qrRes, barcodeRes] = await Promise.all([
        fetch(`https://www.compraentradas.com${parsed.qrPath}`),
        fetch(`https://www.compraentradas.com${parsed.barcodePath}`),
      ]);
      if (!qrRes.ok || !barcodeRes.ok) {
        throw new HttpsError("internal", "No se pudieron descargar las imágenes.");
      }

      const [qrDataUrl, barcodeDataUrl] = await Promise.all([
        blobToDataUrl(qrRes),
        blobToDataUrl(barcodeRes),
      ]);

      return {
        accessCode: parsed.accessCode,
        referencia: parsed.referencia || referencia,
        title: parsed.title,
        showtime: parsed.showtime,
        cinema: parsed.cinema,
        seatsText: parsed.seatsText,
        qrDataUrl,
        barcodeDataUrl,
        savedAt: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("fetchEntrada", err);
      throw new HttpsError("internal", "No se pudo obtener la entrada.");
    }
  },
);
