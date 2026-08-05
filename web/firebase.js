import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  initializeAuth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { FIREBASE_CONFIG } from "./firebase-config.js";

const app = initializeApp(FIREBASE_CONFIG);
export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});
export const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");
const googleProvider = new GoogleAuthProvider();

function isAppleMobile() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function codeDocId(code) {
  return encodeURIComponent(code.trim()).replace(/%/g, "_");
}

/** Popup on desktop (Firefox ETP breaks redirect); redirect on iOS. */
export function signInWithGoogle() {
  if (isAppleMobile()) {
    return signInWithRedirect(auth, googleProvider);
  }
  return signInWithPopup(auth, googleProvider);
}

export function completeRedirectSignIn() {
  return getRedirectResult(auth);
}

export function signOut() {
  return firebaseSignOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function validateCodeRemote(code) {
  const fn = httpsCallable(functions, "validateCode");
  const res = await fn({ code: String(code).trim() });
  return res.data;
}

export async function fetchEntradaRemote(referencia) {
  const fn = httpsCallable(functions, "fetchEntrada");
  const res = await fn({ referencia: String(referencia).trim() });
  return res.data;
}

export async function readTicketRemote({ imageBase64, mimeType }) {
  const fn = httpsCallable(functions, "readTicket");
  const res = await fn({ imageBase64, mimeType });
  return res.data;
}

function codesCol(uid) {
  return collection(db, "users", uid, "codes");
}

export async function pullCodes(uid) {
  const snap = await getDocs(codesCol(uid));
  return snap.docs.map((d) => {
    const data = d.data();
    const entry = {
      code: data.code,
      createdAt: data.createdAt,
      expiresAt: data.expiresAt,
      seats: Number(data.seats) || 1,
    };
    if (data.pendingActivation) entry.pendingActivation = true;
    return entry;
  });
}

export async function upsertCode(uid, entry) {
  const payload = {
    code: entry.code,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    seats: entry.seats,
  };
  if (entry.pendingActivation) payload.pendingActivation = true;
  await setDoc(doc(codesCol(uid), codeDocId(entry.code)), payload);
}

export async function deleteCodeRemote(uid, code) {
  await deleteDoc(doc(codesCol(uid), codeDocId(code)));
}

/** Remote is membership source of truth; local wins fields when both exist. */
export function mergeRemoteMembership(local, remote) {
  const localMap = new Map(local.map((i) => [i.code.trim(), i]));
  return remote.map((r) => localMap.get(r.code.trim()) || r);
}

/** Pull + merge. Firestore membership wins even when empty. */
export async function syncCodes(uid, local) {
  const remote = await pullCodes(uid);
  return mergeRemoteMembership(local, remote);
}

function ticketsCol(uid) {
  return collection(db, "users", uid, "tickets");
}

export async function pullTickets(uid) {
  const snap = await getDocs(ticketsCol(uid));
  return snap.docs
    .map((d) => {
      const data = d.data();
      if (!data?.accessCode) return null;
      return {
        accessCode: data.accessCode,
        referencia: data.referencia || "",
        title: data.title || "",
        showtime: data.showtime || "",
        cinema: data.cinema || "",
        seatsText: data.seatsText || "",
        qrDataUrl: data.qrDataUrl || "",
        barcodeDataUrl: data.barcodeDataUrl || "",
        savedAt: data.savedAt || "",
      };
    })
    .filter(Boolean);
}

export async function upsertTicket(uid, ticket) {
  const payload = {
    accessCode: ticket.accessCode,
    referencia: ticket.referencia || "",
    title: ticket.title || "",
    showtime: ticket.showtime || "",
    cinema: ticket.cinema || "",
    seatsText: ticket.seatsText || "",
    qrDataUrl: ticket.qrDataUrl || "",
    barcodeDataUrl: ticket.barcodeDataUrl || "",
    savedAt: ticket.savedAt || "",
  };
  await setDoc(doc(ticketsCol(uid), codeDocId(ticket.accessCode)), payload);
}

export async function deleteTicketRemote(uid, accessCode) {
  await deleteDoc(doc(ticketsCol(uid), codeDocId(accessCode)));
}

export function mergeRemoteTickets(local, remote) {
  const localMap = new Map(local.map((i) => [i.accessCode.trim(), i]));
  return remote.map((r) => localMap.get(r.accessCode.trim()) || r);
}

export async function syncTickets(uid, local) {
  const remote = await pullTickets(uid);
  return mergeRemoteTickets(local, remote);
}
