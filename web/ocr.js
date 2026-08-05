import { readTicketRemote } from "./firebase.js";

const MAX_EDGE = 1280;
const JPEG_QUALITY = 0.82;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("img_load_failed"));
    img.src = src;
  });
}

/** Downscale + JPEG to keep callable payload small. */
async function compressImage(file) {
  const dataUrl = await fileToDataUrl(file);
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_failed");
  ctx.drawImage(img, 0, 0, w, h);
  const jpeg = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const base64 = jpeg.replace(/^data:image\/jpeg;base64,/, "");
  return { imageBase64: base64, mimeType: "image/jpeg" };
}

/** Compress photo and ask Cloud Function (Gemini) to extract ticket fields. */
export async function readTicketImage(file) {
  const payload = await compressImage(file);
  const data = await readTicketRemote(payload);
  return {
    referencia: String(data?.referencia || ""),
    seats: String(data?.seats || ""),
    createdAt: String(data?.createdAt || ""),
  };
}
