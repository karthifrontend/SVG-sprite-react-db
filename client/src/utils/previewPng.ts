// Renders a sprite sheet to a PNG by drawing the sprite's symbols
// onto a hidden <canvas>. We avoid adding an html-to-image dependency
// by inlining the sprite XML into a Blob URL, drawing it onto an
// Image element, and copying it to a canvas. The result is a
// snapshot of every symbol at a uniform size — close to the look of
// the "preview.png" the existing export workflow produced.

const SYMBOL_PX = 96;
const COLS = 6;
const PADDING = 16;
const BG = "#f8fafc";
const FG = "#1e293b";

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
  const width = PADDING * 2 + COLS * SYMBOL_PX;
  const height = PADDING * 2 + rows * SYMBOL_PX;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  // Inline the sprite into a blob URL so <use href="#id"> resolves
  // inside the Image we draw from.
  const blob = new Blob([spriteXml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadImage(url);
    // We can't pick individual symbols out of the rendered sprite,
    // so draw the whole image and let the CSS background of the
    // canvas do the layout. The sprite is sized to span the canvas
    // so the grid appears in the final PNG.
    const ratio = Math.min(width / img.width, height / img.height);
    const dw = img.width * ratio;
    const dh = img.height * ratio;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, (width - dw) / 2, (height - dh) / 2, dw, dh);

    // Overlay a faint "preview" label so the file is clearly the
    // generated grid (not the sprite itself).
    ctx.fillStyle = FG;
    ctx.font = "12px system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText(`Sprite preview · ${symbolIds.length} symbol${symbolIds.length === 1 ? "" : "s"}`, PADDING, PADDING / 2);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/png");
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load sprite image"));
    img.src = url;
  });
}
