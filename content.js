(function () {
  if (document.getElementById("ucc-save-ticket")) return;

  async function imgToDataUrl(img) {
    const src = img?.currentSrc || img?.src;
    if (!src) throw new Error("missing_img");
    const res = await fetch(src, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`img_fetch_${res.status}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("dataurl_failed"));
      reader.readAsDataURL(blob);
    });
  }

  function codeFromImgSrc(src) {
    try {
      const url = new URL(src, location.origin);
      return url.searchParams.get("Codigo") || "";
    } catch {
      return "";
    }
  }

  function parseTicket() {
    const qrImg = document.querySelector('img[src*="/qrcode/"]');
    const barcodeImg = document.querySelector('img[src*="/codbarras/"]');
    if (!qrImg || !barcodeImg) return null;

    const bodyText = document.body?.innerText || "";
    const accessFromText = (bodyText.match(/C[oó]digo de barras:\s*(\d+)/i) || [])[1] || "";
    const accessCode =
      accessFromText ||
      codeFromImgSrc(qrImg.src) ||
      codeFromImgSrc(barcodeImg.src);

    const refMatch =
      (document.querySelector("h3")?.textContent || "").match(/Referencia\s+(\d+)/i) ||
      bodyText.match(/Referencia\s+(\d+)/i);
    const referencia = refMatch ? refMatch[1] : "";

    const posterImg = document.querySelector('img[src*="/Carteles/"]');
    const infoCol =
      posterImg?.closest(".col-md-4")?.nextElementSibling ||
      document.querySelector(".col-md-8.text-sm-left");
    let title = (posterImg?.alt || "").trim();
    let showtime = "";
    let cinema = "";
    let seatsText = "";

    if (infoCol) {
      const lines = infoCol.innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (!title || /promoci/i.test(title)) {
        title =
          lines.find(
            (l) =>
              !/\d{2}\/\d{2}\/\d{4}/.test(l) &&
              !/butaca|entrada|total|cif|€|promoci|referencia|metromar|mendivil|mairena|cc\s/i.test(l),
          ) || title;
      }
      showtime = lines.find((l) => /\d{2}\/\d{2}\/\d{4}/.test(l)) || "";
      cinema = lines.find((l) => /cinemas/i.test(l)) || "";
      const seatLines = lines.filter((l) => /Butaca Fila/i.test(l));
      seatsText = seatLines
        .map((l) => {
          const m = l.match(/Fila:\s*(\d+),\s*Butaca:\s*(\d+)/i);
          return m ? `Fila ${m[1]} Butaca ${m[2]}` : l;
        })
        .join("; ");
    }

    return {
      accessCode: String(accessCode).trim(),
      referencia,
      title,
      showtime,
      cinema,
      seatsText,
      qrImg,
      barcodeImg,
    };
  }

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = `ucc-save-ticket__status ucc-save-ticket__status--${kind}`;
    el.hidden = !text;
  }

  function mount() {
    const parsed = parseTicket();
    if (!parsed?.accessCode) return;
    if (document.getElementById("ucc-ticket-frame")) return;

    const qrP = parsed.qrImg.closest("p");
    const barcodeP = parsed.barcodeImg.closest("p");
    if (!qrP || !barcodeP || !qrP.parentNode) return;

    const frame = document.createElement("div");
    frame.id = "ucc-ticket-frame";
    frame.className = "ucc-ticket-frame";
    qrP.parentNode.insertBefore(frame, qrP);
    frame.append(qrP, barcodeP);

    const wrap = document.createElement("div");
    wrap.id = "ucc-save-ticket";
    wrap.className = "ucc-save-ticket";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ucc-save-ticket__btn";

    const logo = document.createElement("img");
    logo.className = "ucc-save-ticket__logo";
    logo.src = browser.runtime.getURL("icons/icon-32.png");
    logo.alt = "";
    logo.width = 22;
    logo.height = 22;

    const label = document.createElement("span");
    label.textContent = "Guardar entrada";
    btn.append(logo, label);

    const status = document.createElement("p");
    status.className = "ucc-save-ticket__status";
    status.hidden = true;
    status.setAttribute("aria-live", "polite");

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      setStatus(status, "Guardando…", "info");
      try {
        const [qrDataUrl, barcodeDataUrl] = await Promise.all([
          imgToDataUrl(parsed.qrImg),
          imgToDataUrl(parsed.barcodeImg),
        ]);
        const ticket = {
          accessCode: parsed.accessCode,
          referencia: parsed.referencia,
          title: parsed.title,
          showtime: parsed.showtime,
          cinema: parsed.cinema,
          seatsText: parsed.seatsText,
          qrDataUrl,
          barcodeDataUrl,
          savedAt: new Date().toISOString(),
        };
        const res = await browser.runtime.sendMessage({ type: "save-ticket", ticket });
        if (!res?.ok) {
          if (res?.error === "not_signed_in") {
            setStatus(status, "Inicia sesión en UCC Manager.", "error");
          } else {
            setStatus(status, "No se pudo guardar.", "error");
          }
          return;
        }
        setStatus(
          status,
          res.created ? "Entrada guardada." : "Entrada actualizada.",
          "ok",
        );
      } catch {
        setStatus(status, "No se pudo guardar.", "error");
      } finally {
        btn.disabled = false;
      }
    });

    wrap.append(btn, status);
    frame.appendChild(wrap);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
