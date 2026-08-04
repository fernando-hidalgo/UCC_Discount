// Code 128 patterns: module widths. Indices 0–106 (Stop = 2331112).
const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const STOP = 106;

function code128Value(ch) {
  const code = ch.charCodeAt(0);
  if (code < 32 || code > 127) {
    throw new Error(`Code 128B no admite: ${ch}`);
  }
  return code - 32;
}

function code128Checksum(text) {
  let sum = START_B;
  for (let i = 0; i < text.length; i++) {
    sum += (i + 1) * code128Value(text[i]);
  }
  return sum % 103;
}

/** @returns {number[]} symbol values including start, data, checksum, stop */
function encodeCode128(text) {
  if (!text) throw new Error("Texto vacío");
  const symbols = [START_B];
  for (const ch of text) {
    symbols.push(code128Value(ch));
  }
  symbols.push(code128Checksum(text));
  symbols.push(STOP);
  return symbols;
}

function patternsToModules(symbols) {
  let modules = "";
  for (const value of symbols) {
    modules += CODE128_PATTERNS[value];
  }
  return modules;
}

/**
 * @param {string} text
 * @returns {string} SVG markup
 */
function renderBarcodeSvg(text) {
  const modules = patternsToModules(encodeCode128(text));
  const quiet = 10;
  const barHeight = 80;
  const moduleWidth = 2;
  const labelH = 22;
  let moduleCount = 0;
  for (const digit of modules) moduleCount += Number(digit);
  const width = (moduleCount + quiet * 2) * moduleWidth;
  const height = barHeight + labelH + 8;

  let x = quiet * moduleWidth;
  let bars = "";
  let black = true;
  for (const digit of modules) {
    const w = Number(digit) * moduleWidth;
    if (black) {
      bars += `<rect x="${x}" y="4" width="${w}" height="${barHeight}" fill="#000"/>`;
    }
    x += w;
    black = !black;
  }

  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="Código de barras ${escaped}">
  <rect width="${width}" height="${height}" fill="#fff"/>
  ${bars}
  <text x="${width / 2}" y="${barHeight + 20}" text-anchor="middle" font-family="monospace" font-size="14" fill="#000">${escaped}</text>
</svg>`;
}

// Self-check: checksum for sample ticket reference
{
  const sample = "212867179805";
  const expected = 102;
  const got = code128Checksum(sample);
  if (got !== expected) {
    throw new Error(`barcode.js checksum fail: ${sample} → ${got}, expected ${expected}`);
  }
  if (CODE128_PATTERNS.length !== 107) {
    throw new Error(`barcode.js patterns length ${CODE128_PATTERNS.length}, expected 107`);
  }
  if (CODE128_PATTERNS[START_B] !== "211214" || CODE128_PATTERNS[STOP] !== "2331112") {
    throw new Error("barcode.js start/stop patterns incorrect");
  }
}
