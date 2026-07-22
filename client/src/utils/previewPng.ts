// Renders a sprite sheet to a PNG by drawing each symbol onto its own
// card on a hidden <canvas>. We avoid adding an html-to-image dependency
// by inlining the sprite XML into a Blob URL, parsing each <symbol> and
// re-serialising it as a tiny data: URL we can drawImage onto the
// canvas. The result is a "preview.png" with one card per symbol,
// matching the on-screen design of the live demo / library panel.

const SYMBOL_PX = 96;
const CARD_PADDING_X = 16;
const CARD_PADDING_Y = 24;
const CARD_GAP = 16;
const PAGE_PADDING = 24;
const TITLE_HEIGHT = 56;
const FOOTER_HEIGHT = 20;
const COLS = 6;

const BG = "#f8fafc";
const CARD_BG = "#ffffff";
const CARD_BORDER = "#e2e8f0";
const FG = "#0f172a";
const MUTED = "#64748b";
const ICON = "#1e293b";

/**
 * Render the supplied sprite XML to a PNG blob. Returns `null` if
 * the browser cannot produce the image (e.g. a symbol with an
 * external reference or a parse error).
 */
export async function renderSpritePreviewPng(
  spriteXml: string,
  symbolIds: string[]
): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  if (!spriteXml || symbolIds.length === 0) return null;

  const rows = Math.max(1, Math.ceil(symbolIds.length / COLS));
  const cellWidth = CARD_PADDING_X * 2 + SYMBOL_PX;
  const cellHeight = CARD_PADDING_Y * 2 + SYMBOL_PX + 20; // 20px for label
  const width =
    PAGE_PADDING * 2 + COLS * cellWidth + (COLS - 1) * CARD_GAP;
  const height =
    PAGE_PADDING * 2 +
    TITLE_HEIGHT +
    rows * cellHeight +
    (rows - 1) * CARD_GAP +
    FOOTER_HEIGHT;

  const canvas = document.createElement("canvas");
  // 2x device-pixel-ratio for crisper PNG output when available.
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // Page background.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  // Title.
  ctx.fillStyle = FG;
  ctx.font = "600 22px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textBaseline = "top";
  const symbolWord = symbolIds.length === 1 ? "Symbol" : "Symbols";
  ctx.fillText(
    `SVG Sprite \u2014 ${symbolIds.length} ${symbolWord}`,
    PAGE_PADDING,
    PAGE_PADDING
  );

  // Parse the sprite so we can pull each symbol's viewBox + inner
  // markup out individually.
  const parser = new DOMParser();
  const doc = parser.parseFromString(spriteXml, "image/svg+xml");
  if (doc.querySelector("parsererror")) return null;
  const symbolEls = Array.from(doc.getElementsByTagName("symbol"));

  for (let i = 0; i < symbolIds.length; i++) {
    const id = symbolIds[i];
    const symbolEl = symbolEls.find((el) => el.getAttribute("id") === id);
    if (!symbolEl) continue;

    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cellX = PAGE_PADDING + col * (cellWidth + CARD_GAP);
    const cellY =
      PAGE_PADDING + TITLE_HEIGHT + row * (cellHeight + CARD_GAP);

    // Card.
    drawCard(ctx, cellX, cellY, cellWidth, cellHeight);

    // Icon (centered inside the card's icon area).
    const iconAreaY = cellY + CARD_PADDING_Y;
    const iconAreaX = cellX + (cellWidth - SYMBOL_PX) / 2;
    const viewBox = symbolEl.getAttribute("viewBox") || "0 0 24 24";
    const thisInner = Array.from(symbolEl.childNodes)
      .map((n) => (n as Element).outerHTML ?? n.nodeValue ?? "")
      .join("")
      .trim();

    const iconDataUrl = renderSymbolToDataUrl(
      id,
      viewBox,
      thisInner,
      SYMBOL_PX,
      ICON
    );
    await drawDataUrlImage(ctx, iconDataUrl, iconAreaX, iconAreaY, SYMBOL_PX, SYMBOL_PX);

    // Label.
    ctx.fillStyle = MUTED;
    ctx.font = "500 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(id, cellX + cellWidth / 2, cellY + CARD_PADDING_Y + SYMBOL_PX + 8);
    ctx.textAlign = "left";
  }

  // Footer.
  ctx.fillStyle = MUTED;
  ctx.font = "11px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(
    `Generated \u00B7 ${new Date().toLocaleDateString()}`,
    width - PAGE_PADDING,
    height - 4
  );
  ctx.textAlign = "left";

  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/png");
  });
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number
) {
  // Subtle shadow.
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, 0.06)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = CARD_BG;
  ctx.fill();
  ctx.restore();

  // Border.
  roundRect(ctx, x, y, w, h, 12);
  ctx.strokeStyle = CARD_BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Build a standalone SVG string for a single symbol and return a
 * data: URL we can drawImage onto the canvas. Using a data URL
 * avoids needing a separate fetch / load step per symbol.
 */
function renderSymbolToDataUrl(
  id: string,
  viewBox: string,
  inner: string,
  size: number,
  color: string
): string {
  // Re-color hard-coded fills / strokes to currentColor so the
  // surrounding <svg color="..."> attribute can style the icon.
  // We leave `none` and `currentColor` alone so transparent parts
  // stay transparent.
  const styled = inner
    .replace(/\sfill="(?!none|currentColor)[^"]*"/gi, ' fill="currentColor"')
    .replace(/\sstroke="(?!none|currentColor)[^"]*"/gi, ' stroke="currentColor"');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}" color="${color}"><g>${styled}</g></svg>`;
  // Encode as a UTF-8 data URL.
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

function drawDataUrlImage(
  ctx: CanvasRenderingContext2D,
  dataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        ctx.drawImage(img, x, y, w, h);
      } catch {
        /* swallow individual icon errors so the rest still draws */
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = dataUrl;
  });
}
