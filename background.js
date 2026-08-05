const VALIDATION_URL = "https://www.compraentradas.com/Sesion/VuelvePor5";
const MSG_EXPIRED = "han pasado más de 60 días";
const MSG_NOT_YET = "24 horas después de la compra";
const MSG_SEATS_REDEEMED = "ya se han canjeado todas las butacas";
const MSG_INVALID = "La referencia no es válida";
const TICKETS_KEY = "tickets";
/* AUTH_KEY + getRedirectUri come from sync.js (loaded before this script) */

async function fetchValidationBody(code) {
  const url = `${VALIDATION_URL}?Referencia=${encodeURIComponent(code)}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

function parseValidationResult(body) {
  const message = typeof body === "string" ? body : String(body);

  if (message.includes(MSG_EXPIRED)) {
    return { status: "expired" };
  }

  if (message.includes(MSG_NOT_YET)) {
    return { status: "not_yet_valid" };
  }

  if (message.includes(MSG_SEATS_REDEEMED)) {
    return { status: "seats_redeemed" };
  }

  if (message.includes(MSG_INVALID)) {
    return { status: "invalid" };
  }

  return { status: "valid" };
}

async function validateCode(code) {
  const body = await fetchValidationBody(code);
  return parseValidationResult(body);
}

function parseHashParams(redirectedTo) {
  const hash = redirectedTo.includes("#") ? redirectedTo.split("#")[1] : "";
  return Object.fromEntries(new URLSearchParams(hash));
}

/** Must run in background — popup closes during Google login and aborts the flow. */
async function googleLaunchAndFirebaseSignIn() {
  if (typeof GOOGLE_OAUTH_CLIENT_ID === "undefined" || typeof FIREBASE_CONFIG === "undefined") {
    throw new Error("firebase_config_missing");
  }

  const redirectUri = getRedirectUri();
  console.log("[ucc-auth] redirect_uri=", redirectUri);
  console.log("[ucc-auth] client_id=", GOOGLE_OAUTH_CLIENT_ID);

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_OAUTH_CLIENT_ID);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("prompt", "select_account");

  const redirectedTo = await browser.identity.launchWebAuthFlow({
    url: authUrl.href,
    interactive: true,
  });

  const params = parseHashParams(redirectedTo);
  if (params.error) throw new Error(params.error);
  const accessToken = params.access_token;
  if (!accessToken) throw new Error("no_access_token");

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_CONFIG.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postBody: `access_token=${accessToken}&providerId=google.com`,
        requestUri: redirectUri,
        returnIdpCredential: true,
        returnSecureToken: true,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || "firebase_signin_failed");
  }
  const data = await res.json();
  const session = {
    uid: data.localId,
    email: data.email || "",
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
  };
  await setAuthSession(session);
  return { uid: session.uid, email: session.email };
}

async function saveTicketFromPage(ticket) {
  const session = await getValidSession();
  if (!session) return { ok: false, error: "not_signed_in" };

  const accessCode = String(ticket?.accessCode || "").trim();
  if (!accessCode || !ticket?.qrDataUrl || !ticket?.barcodeDataUrl) {
    return { ok: false, error: "invalid_ticket" };
  }

  const entry = {
    accessCode,
    referencia: String(ticket.referencia || "").trim(),
    title: String(ticket.title || "").trim(),
    showtime: String(ticket.showtime || "").trim(),
    cinema: String(ticket.cinema || "").trim(),
    seatsText: String(ticket.seatsText || "").trim(),
    qrDataUrl: ticket.qrDataUrl,
    barcodeDataUrl: ticket.barcodeDataUrl,
    savedAt: ticket.savedAt || new Date().toISOString(),
  };

  const result = await browser.storage.local.get(TICKETS_KEY);
  const tickets = result[TICKETS_KEY] || [];
  const idx = tickets.findIndex((t) => t.accessCode.trim() === accessCode);
  const created = idx === -1;
  if (created) {
    tickets.push(entry);
  } else {
    tickets[idx] = { ...tickets[idx], ...entry };
  }
  await browser.storage.local.set({ [TICKETS_KEY]: tickets });

  try {
    await upsertRemoteTicket(entry);
  } catch {
    /* local kept; retry on next sync */
  }

  return { ok: true, created };
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "validate-code") {
    return validateCode(message.code);
  }
  if (message?.type === "get-redirect-uri") {
    return Promise.resolve(getRedirectUri());
  }
  if (message?.type === "google-sign-in") {
    return googleLaunchAndFirebaseSignIn().catch((err) => {
      throw new Error(err?.message || String(err));
    });
  }
  if (message?.type === "save-ticket") {
    return saveTicketFromPage(message.ticket).catch((err) => ({
      ok: false,
      error: err?.message || String(err),
    }));
  }
  return undefined;
});
