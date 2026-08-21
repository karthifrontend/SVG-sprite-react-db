// Builds sprite XML, extracts symbols, validates SVG files, and formats sizes/dates.
export type SpriteSymbol = {
  id: string;
  viewBox: string;
  inner: string;
};
const ICON_PREFIX = "icon-";
export function compareSymbolId(a: string, b: string): number {
  if (a === b) return 0;
  const stripPrefix = (id: string): string =>
    id.toLowerCase().startsWith(ICON_PREFIX)
      ? id.slice(ICON_PREFIX.length)
      : id;
  const left = stripPrefix(a);
  const right = stripPrefix(b);
  const re = /(\d+)|(\D+)/g;
  const aParts: Array<{ num: number; text: string }> = [];
  const bParts: Array<{ num: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(left)) !== null) {
    aParts.push(
      m[1] !== undefined
        ? { num: parseInt(m[1], 10), text: "" }
        : { num: NaN, text: m[2] },
    );
  }
  re.lastIndex = 0;
  while ((m = re.exec(right)) !== null) {
    bParts.push(
      m[1] !== undefined
        ? { num: parseInt(m[1], 10), text: "" }
        : { num: NaN, text: m[2] },
    );
  }
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i += 1) {
    const ap = aParts[i];
    const bp = bParts[i];
    if (Number.isNaN(ap.num) && Number.isNaN(bp.num)) {
      const c = ap.text.localeCompare(bp.text, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (c !== 0) return c;
      continue;
    }
    if (Number.isNaN(ap.num)) return -1;
    if (Number.isNaN(bp.num)) return 1;
    if (ap.num !== bp.num) return ap.num - bp.num;
  }
  if (aParts.length !== bParts.length) return aParts.length - bParts.length;
  return a.localeCompare(b);
}

// Returns a new array of symbols sorted by id using `compareSymbolId`. Pure / non-mutating
// so callers can keep the original merge order around for diffing.
export function sortSymbolsById<T extends { id: string }>(symbols: T[]): T[] {
  return [...symbols].sort((a, b) => compareSymbolId(a.id, b.id));
}

// Lightweight, locale-aware date formatter used in the library panel.
export function formatDate(value?: string): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

// Human-readable byte size formatter used by the file list.
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Cross-browser clipboard copy that falls back to `execCommand` when the modern Clipboard API is unavailable.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (text === undefined || text === null) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy shim below
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

// Synchronously classify a raw SVG string as either a "sprite sheet" (a document whose root <svg> contains at least one <symbol>) or a standalone "single icon". Used by the dropzone hooks to enforce that each upload section only accepts the right kind of file.
export function isSpriteSvgText(text: string): boolean {
  if (!text) return false;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "image/svg+xml");
    if (doc.querySelector("parsererror")) return false;
    const svg = doc.querySelector("svg");
    if (!svg) return false;
    return svg.getElementsByTagName("symbol").length > 0;
  } catch {
    return false;
  }
}

// Async variant that reads a `File` and delegates to `isSpriteSvgText`. Returns `false` for unreadable / non-SVG files so the caller can treat them as "not a sprite" without a separate try/catch.
export async function isSpriteSvgFile(file: File): Promise<boolean> {
  if (!file) return false;
  try {
    const text = await file.text();
    return isSpriteSvgText(text);
  } catch {
    return false;
  }
}

export function sanitizeSymbolName(
  rawName: string,
  fallbackIndex?: number,
): string {
  let name = (rawName || "").trim();
  // Drop the extension.
  name = name.replace(/\.svg$/i, "");
  // Drop " (N)" / " - Copy" / " - Copy (N)" suffixes that file managers tack on to duplicates. Each pattern is anchored to the end of the name and is case-insensitive.
  name = name.replace(/\s*\(\d+\)\s*$/i, "");
  name = name.replace(/\s*-\s*copy(\s*\(\d+\))?\s*$/i, "");
  name = name.replace(/\s+copy(\s*\(\d+\))?\s*$/i, "");
  // Replace any disallowed char (spaces, dots, parentheses, etc.) with a dash. Repeat chars collapse on the next pass.
  name = name.replace(/[^a-zA-Z0-9_-]+/g, "-");
  name = name.replace(/-+/g, "-");
  name = name.replace(/^-+|-+$/g, "");

  // Apply the `icon-` prefix only if the name doesn't already start with it. The leading character group check tolerates any prefix separator we may have just collapsed (so `Icon-foo` -> `icon-foo` rather than `icon-icon-foo`).
  const prefix = "icon-";
  const lower = name.toLowerCase();
  if (lower === "icon" || lower === "icons") {
    // Pure "icon"/"icons" becomes "icon" so the resulting id is a valid non-empty string and not just the prefix.
    name = "icon";
  } else if (lower.startsWith("icon-")) {
    // Normalise the prefix to lowercase so we never end up with `Icon-foo` / `ICON-foo` ids in the generated sprite.
    name = prefix + name.slice(prefix.length);
  } else if (name.length > 0) {
    name = prefix + name;
  }

  if (!name) {
    return typeof fallbackIndex === "number"
      ? `${prefix}${fallbackIndex + 1}`
      : prefix.replace(/-$/, "");
  }
  return name;
}

// Parse an uploaded SVG file into a symbol description that can be embedded inside a sprite sheet. Symbol IDs are derived from the filename.
export async function svgFileToSymbol(file: File): Promise<SpriteSymbol> {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error(`Invalid SVG: ${file.name}`);

  // Prefer viewBox; fall back to width/height or 24x24.
  let viewBox = svg.getAttribute("viewBox") || "";
  if (!viewBox) {
    const w = svg.getAttribute("width") || "24";
    const h = svg.getAttribute("height") || "24";
    viewBox = `0 0 ${parseFloat(w)} ${parseFloat(h)}`;
  }

  // Strip wrapper-level artefacts that icon-export tools (Storyset, undraw,
  // drawkit, ...) leave behind and that break the sprite-host render path.
  const inner = stripUploadOnlyWrapperArtifacts(svg, viewBox);

  // Symbol id from filename. The sanitizer is the single source of truth for id formatting: it strips the extension, drops copy-suffixes, replaces bad characters, and prefixes `icon-` when the name doesn't already start with it.
  const id = sanitizeSymbolName(file.name);

  return { id, viewBox, inner };
}

function stripUploadOnlyWrapperArtifacts(svg: Element, viewBox: string): string {
  const viewBoxParts = viewBox.split(/\s+/).map((p) => parseFloat(p));
  const vbWidth = Number.isFinite(viewBoxParts[2]) ? viewBoxParts[2] : NaN;
  const vbHeight = Number.isFinite(viewBoxParts[3]) ? viewBoxParts[3] : NaN;
  const noOpClipIds = new Set<string>();
  const defBlocks: Element[] = [];
  const defIds = new Set<string>();
  Array.from(svg.childNodes).forEach((node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    if (el.tagName.toLowerCase() !== "defs") return;
    defBlocks.push(el);
    Array.from(el.children).forEach((child) => {
      const id = child.getAttribute("id");
      if (id) defIds.add(id);
      if (
        child.tagName.toLowerCase() === "clippath" &&
        isFullViewBoxRectNoOpClipPath(child, vbWidth, vbHeight)
      ) {
        if (id) noOpClipIds.add(id);
      }
    });
  });

  const referencedDefIds = new Set<string>();
  Array.from(svg.childNodes).forEach((node) => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "g" && isNoOpClipWrapper(el, noOpClipIds)) {
      return;
    }
    collectUrlReferences(el, defIds, referencedDefIds);
  });
  const defsStillReferenced = Array.from(defIds).some((id) =>
    referencedDefIds.has(id),
  );
  const canSafelyDropDefs = defBlocks.length > 0 && !defsStillReferenced;

  const inheritedPaint = collectInheritedPaintAttributes(svg);
  if (inheritedPaint) {
    promoteInheritedPaintAttributes(svg, inheritedPaint);
  }

  const finalOutput: string[] = [];
  Array.from(svg.childNodes).forEach((node) => {
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? "").trim();
      if (text) finalOutput.push(text);
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === "defs") {
      if (canSafelyDropDefs) return;
    } else if (tag === "g" && isNoOpClipWrapper(el, noOpClipIds)) {
      promoteInheritedPaintAttributes(el, inheritedPaint);
      Array.from(el.childNodes).forEach((child) => {
        const serialised = serialiseNode(child);
        if (serialised) finalOutput.push(serialised);
      });
      return;
    }
    const serialised = serialisedEl(el);
    if (serialised) finalOutput.push(serialised);
  });
  return finalOutput.join("").trim();
}

// Paint attributes that can be inherited from an SVG root and need to be
// promoted onto child elements before serialisation. Keep this list in sync
// with what `extractColorValues` / `countPaintableShapes` recognise.
const PAINTABLE_TAGS = new Set([
  "path",
  "line",
  "circle",
  "rect",
  "polygon",
  "polyline",
  "ellipse",
]);

function readPaintFromStyle(
  styleAttr: string,
): { fill: string | null; stroke: string | null } {
  const out = { fill: null as string | null, stroke: null as string | null };
  if (!styleAttr) return out;
  const re = /\b(fill|stroke)\s*:\s*([^;"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(styleAttr)) !== null) {
    const prop = m[1].toLowerCase();
    const value = m[2].trim();
    // Inline `fill:none` / `stroke:none` etc. count as an explicit value the
    // author set on the root; we still want to honour it.
    out[prop as "fill" | "stroke"] = value;
  }
  return out;
}

// Capture the explicit fill/stroke values declared on the SVG root (via
// either attributes or an inline `style` declaration). Returns `null` when
// the root has no paint info to promote, so callers can skip the work
// entirely on icons that already declare everything per-element.
function collectInheritedPaintAttributes(
  svg: Element,
): { fill: string | null; stroke: string | null } | null {
  const attrFill = svg.getAttribute("fill");
  const attrStroke = svg.getAttribute("stroke");
  const stylePaint = readPaintFromStyle(svg.getAttribute("style") ?? "");
  const fill = stylePaint.fill ?? attrFill;
  const stroke = stylePaint.stroke ?? attrStroke;
  if (fill === null && stroke === null) return null;
  // `fill` / `stroke` attributes that are missing render as the browser's
  // default (black) — but only when no rule says otherwise. We intentionally
  // don't synthesise defaults here; the goal is "preserve what the author
  // wrote" so existing icons (no root paint → existing behaviour) are not
  // touched.
  return { fill, stroke };
}

// Walk every paintable descendant under `root` and set fill / stroke that
// aren't already explicitly declared. Nested `<svg>` elements form a new
// "root" for inheritance, so we recurse into them with their own paint
// values; other elements just inherit from the outer root.
function promoteInheritedPaintAttributes(
  root: Element,
  inherited: { fill: string | null; stroke: string | null } | null,
): void {
  if (!inherited) return;
  if ((inherited.fill ?? null) === null && (inherited.stroke ?? null) === null) {
    return;
  }
  const collectAndApply = (
    node: Element,
    paint: { fill: string | null; stroke: string | null },
  ): void => {
    const own = readPaintFromStyle(node.getAttribute("style") ?? "");
    if (PAINTABLE_TAGS.has(node.tagName.toLowerCase())) {
      if (paint.fill !== null && !node.hasAttribute("fill") && !own.fill) {
        node.setAttribute("fill", paint.fill);
      }
      if (paint.stroke !== null && !node.hasAttribute("stroke") && !own.stroke) {
        node.setAttribute("stroke", paint.stroke);
      }
    }
    // Nested `<svg>` starts its own inheritance block — pull whatever it
    // sets itself off the inherited values, then recurse.
    if (node.tagName.toLowerCase() === "svg" && node !== root) {
      const nestedAttrFill = node.getAttribute("fill");
      const nestedAttrStroke = node.getAttribute("stroke");
      const nested: { fill: string | null; stroke: string | null } = {
        fill: nestedAttrFill ?? paint.fill,
        stroke: nestedAttrStroke ?? paint.stroke,
      };
      Array.from(node.children).forEach((child) => collectAndApply(child, nested));
      return;
    }
    Array.from(node.children).forEach((child) => collectAndApply(child, paint));
  };
  Array.from(root.children).forEach((child) => collectAndApply(child, inherited));
}

function collectUrlReferences(
  el: Element,
  candidateIds: Set<string>,
  out: Set<string>,
): void {
  if (candidateIds.size === 0) return;
  const scanValue = (value: string): void => {
    const re = /url\(\s*#([^)\s]+)\s*\)/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      const id = match[1];
      if (candidateIds.has(id)) out.add(id);
    }
  };
  for (let i = 0; i < el.attributes.length; i += 1) {
    scanValue(el.attributes[i].value);
  }
  const style = el.getAttribute("style");
  if (style) scanValue(style);
}

function isFullViewBoxRectNoOpClipPath(
  el: Element,
  vbWidth: number,
  vbHeight: number,
): boolean {
  if (el.tagName.toLowerCase() !== "clippath") return false;
  if (el.children.length !== 1) return false;
  const only = el.children[0];
  if (only.tagName.toLowerCase() !== "rect") return false;
  // Allow the position to be missing/0 — a rect with no x/y defaults to 0,0.
  const x = parseFloat(only.getAttribute("x") ?? "0");
  const y = parseFloat(only.getAttribute("y") ?? "0");
  const w = parseFloat(only.getAttribute("width") ?? "0");
  const h = parseFloat(only.getAttribute("height") ?? "0");
  if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
  if (!Number.isFinite(vbWidth) || !Number.isFinite(vbHeight)) {
    return x === 0 && y === 0 && w > 0 && h > 0;
  }
  return x === 0 && y === 0 && w === vbWidth && h === vbHeight;
}

function isNoOpClipWrapper(g: Element, noOpClipIds: Set<string>): boolean {
  if (g.tagName.toLowerCase() !== "g") return false;
  const clipAttr = g.getAttribute("clip-path");
  if (!clipAttr) return false;
  const match = clipAttr.match(/^url\(#(.+?)\)$/i);
  if (!match) return false;
  if (!noOpClipIds.has(match[1])) return false;
  for (let i = 0; i < g.attributes.length; i += 1) {
    const name = g.attributes[i].name.toLowerCase();
    if (name === "clip-path") continue;
    return false;
  }
  return true;
}

function serialiseNode(node: ChildNode): string {
  if (node.nodeType === 1) return serialisedEl(node as Element);
  if (node.nodeType === 3) return (node.nodeValue ?? "").trim();
  return "";
}

function serialisedEl(el: Element): string {
  return (el as Element).outerHTML ?? "";
}

// Build a complete sprite SVG document from a list of symbols.
export function buildSpriteXml(symbols: SpriteSymbol[]): string {
  const symbolsXml = symbols
    .map(
      (s) => `<symbol id="${s.id}" viewBox="${s.viewBox}">${s.inner}</symbol>`,
    )
    .join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n  ${symbolsXml}\n</svg>`;
}

// Extract every <symbol> from an existing sprite XML string so it can be merged with newly uploaded icons. Falls back to an empty list when the document cannot be parsed.
export function extractSymbolsFromSprite(xml: string): SpriteSymbol[] {
  if (!xml) return [];
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "image/svg+xml");
    if (doc.querySelector("parsererror")) return [];
    const symbolEls = Array.from(doc.getElementsByTagName("symbol"));
    return symbolEls
      .map((el) => {
        const id = el.getAttribute("id") || "";
        if (!id) return null;
        const viewBox =
          el.getAttribute("viewBox") ||
          el.getAttribute("data-viewBox") ||
          "0 0 24 24";
        const inner = Array.from(el.childNodes)
          .map((node) => (node as Element).outerHTML ?? node.nodeValue ?? "")
          .join("")
          .trim();
        return { id, viewBox, inner };
      })
      .filter((s): s is SpriteSymbol => s !== null);
  } catch {
    return [];
  }
}

export type IconVariant = "solid" | "outlined" | "multicolor";

function extractColorValues(markup: string): string[] {
  const values: string[] = [];
  const attrRegex = /\b(fill|stroke)\s*=\s*(['"])(.*?)\2/gi;
  const styleRegex = /\b(fill|stroke)\s*:\s*([^;"'\s]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(markup)) !== null) {
    const value = match[3]?.trim();
    if (!value) continue;
    if (/^(none|transparent|currentcolor|inherit)$/i.test(value)) continue;
    if (value.startsWith("url(")) continue;
    values.push(value);
  }

  while ((match = styleRegex.exec(markup)) !== null) {
    const value = match[2]?.trim();
    if (!value) continue;
    if (/^(none|transparent|currentcolor|inherit)$/i.test(value)) continue;
    if (value.startsWith("url(")) continue;
    values.push(value);
  }

  return values;
}

function countPaintableShapes(markup: string): {
  fills: number;
  strokes: number;
} {
  let fills = 0;
  let strokes = 0;
  const fillAttr = /\bfill\s*=\s*(['"])(.*?)\1/gi;
  const fillStyle = /\bfill\s*:\s*([^;"'\s]+)/gi;
  const strokeAttr = /\bstroke\s*=\s*(['"])(.*?)\1/gi;
  const strokeStyle = /\bstroke\s*:\s*([^;"'\s]+)/gi;
  let match: RegExpExecArray | null;
  const isPaintable = (raw: string): boolean => {
    const value = raw.trim();
    if (!value) return false;
    if (/^(none|transparent|inherit)$/i.test(value)) return false;
    if (value.startsWith("url(")) return false;
    return true;
  };
  while ((match = fillAttr.exec(markup)) !== null) {
    if (isPaintable(match[2] ?? "")) fills += 1;
  }
  while ((match = fillStyle.exec(markup)) !== null) {
    if (isPaintable(match[1] ?? "")) fills += 1;
  }
  while ((match = strokeAttr.exec(markup)) !== null) {
    if (isPaintable(match[2] ?? "")) strokes += 1;
  }
  while ((match = strokeStyle.exec(markup)) !== null) {
    if (isPaintable(match[1] ?? "")) strokes += 1;
  }
  return { fills, strokes };
}

// Classify a symbol's inner markup into the recolouring strategy that should
// be applied. See `IconVariant` for the rationale.
export function classifySymbolVariant(markup: string): IconVariant {
  const colors = extractColorValues(markup);
  const uniqueColors = colors.filter(
    (value, index) => colors.indexOf(value) === index,
  );
  if (uniqueColors.length > 1) return "multicolor";
  const { fills, strokes } = countPaintableShapes(markup);
  if (strokes > 0 && strokes >= fills) return "outlined";
  return "solid";
}

export function isTintableSymbolMarkup(markup: string): boolean {
  return classifySymbolVariant(markup) !== "multicolor";
}

function markTintableSymbols(spriteXml: string): string {
  return spriteXml.replace(
    /(<symbol\b[^>]*>)([\s\S]*?)(<\/symbol>)/g,
    (_full, openTag, inner, closeTag) => {
      const variant = classifySymbolVariant(inner);
      const tintable = variant !== "multicolor";
      const markers = [
        ` data-tintable="${tintable ? "true" : "false"}"`,
        ` data-icon-variant="${variant}"`,
      ];
      let updatedOpenTag = openTag
        .replace(/\s+data-tintable="(?:true|false)"/i, "")
        .replace(/\s+data-icon-variant="(?:solid|outlined|multicolor)"/i, "");
      updatedOpenTag = `${updatedOpenTag.slice(0, -1)}${markers.join("")}>`;
      return `${updatedOpenTag}${inner}${closeTag}`;
    },
  );
}

export function buildDemoHtml(symbolIds: string[], spriteXml: string): string {
  const ids = symbolIds;
  const tintableSpriteXml = markTintableSymbols(spriteXml);
  const iconCards = ids
    .map(
      (id) => `
      <div class="icon-card">
        <div class="icon-preview">
          <svg width="40" height="40"><use href="#${id}"></use></svg>
        </div>
        <span class="icon-label">${id}</span>
      </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG Sprite Demo — ${ids.length} Symbols</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: #f8fafc;
      color: #334155;
      padding: 2rem;
      min-height: 100vh;
    }
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { font-size: 1.75rem; font-weight: 800; color: #0f172a; margin-bottom: 0.5rem; }
    .header p { font-size: 0.875rem; color: #94a3b8; }
    .controls {
      display: flex; align-items: center; justify-content: center;
      gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap;
    }
    .controls label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; }
    .color-btn {
      width: 28px; height: 28px; border-radius: 50%;
      border: 2px solid #e2e8f0; cursor: pointer; transition: all 0.15s;
    }
    .color-btn:hover { transform: scale(1.15); }
    .color-btn.active { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.25); }
    .grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 1rem; max-width: 900px; margin: 0 auto;
    }
    .icon-card {
      background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 1.25rem 0.75rem; display: flex; flex-direction: column;
      align-items: center; gap: 0.75rem; transition: all 0.2s; cursor: pointer;
    }
    .icon-card:hover { border-color: #a5b4fc; box-shadow: 0 4px 12px rgba(99,102,241,0.1); transform: translateY(-2px); }
    .icon-preview {
      width: 100%; height: 80px; display: flex; align-items: center;
      justify-content: center; background: #f1f5f9; border-radius: 8px;
    }
    .icon-preview svg { color: currentColor; transition: color 0.2s; }
    .icon-label {
      font-size: 0.6875rem; font-family: 'Courier New', monospace;
      font-weight: 600; color: #64748b; text-align: center;
      word-break: break-all; max-width: 100%;
    }
    .footer { text-align: center; margin-top: 2.5rem; font-size: 0.75rem; color: #cbd5e1; }
  </style>
</head>
<body>
  ${tintableSpriteXml}
  <div class="header">
    <h1>🎨 SVG Sprite Preview</h1>
    <p>${ids.length} symbol${ids.length !== 1 ? "s" : ""} in sprite.svg</p>
  </div>
  <div class="controls">
    <label>Color:</label>
    <button class="color-btn active" data-color="#334155" style="background:#334155" title="Slate"></button>
    <button class="color-btn" data-color="#4f46e5" style="background:#4f46e5" title="Indigo"></button>
    <button class="color-btn" data-color="#059669" style="background:#059669" title="Emerald"></button>
    <button class="color-btn" data-color="#e11d48" style="background:#e11d48" title="Rose"></button>
    <button class="color-btn" data-color="#d97706" style="background:#d97706" title="Amber"></button>
    <button class="color-btn" data-color="#7c3aed" style="background:#7c3aed" title="Violet"></button>
  </div>
  <div class="grid" id="iconGrid">${iconCards}
  </div>
  <div class="footer">Generated by SVG Sprite Compiler</div>
  <script>
    (function normalizeSymbols() {
      var symbols = document.querySelectorAll('symbol');
      symbols.forEach(function (sym) {
        if (sym.getAttribute('data-tintable') === 'false') return;
        var variant = sym.getAttribute('data-icon-variant') || 'solid';

        var nodes = sym.querySelectorAll('*');
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          // Skip text nodes and non-elements
          if (n.nodeType !== 1) continue;
          // Strip inline style fill/stroke (e.g. style="fill:#abc;stroke:#def")
          if (n.getAttribute('style')) {
            var inlineStyleRegex = new RegExp("(^|;)\\s*(fill|stroke)\\s*:\\s*[^;]+", "gi");
            var s = n.getAttribute('style').replace(
              inlineStyleRegex,
              function (match, p, prop) {
                var value;
                if (variant === 'outlined') {
                  value = prop === 'stroke' ? 'currentColor' : 'none';
                } else {
                  // 'solid' (default) — recolour the fill, nullify the stroke.
                  value = prop === 'fill' ? 'currentColor' : 'none';
                }
                return p + prop + ':' + value;
              }
            );
            n.setAttribute('style', s);
          }
          // Force attribute-based fill/stroke to currentColor / none
          // depending on the icon variant.
          ['fill', 'stroke'].forEach(function (attr) {
            var v = n.getAttribute(attr);
            // Skip values the author already neutralised (e.g. fill="none").
            if (v === 'none') {
              return;
            }
            if (variant === 'outlined') {
              n.setAttribute(attr, attr === 'stroke' ? 'currentColor' : 'none');
            } else {
              // 'solid' (default) — recolour the fill, nullify the stroke.
              n.setAttribute(attr, attr === 'fill' ? 'currentColor' : 'none');
            }
          });
          if (variant === 'solid'
              && !n.getAttribute('fill')
              && !n.getAttribute('style')) {
            n.setAttribute('fill', 'currentColor');
          }
        }
      });
    })();

    document.querySelectorAll('.color-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.color-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var color = btn.getAttribute('data-color');
        document.querySelectorAll('.icon-preview svg').forEach(function (svg) {
          var use = svg.querySelector('use');
          var symbolId = use && use.getAttribute('href') ? use.getAttribute('href').replace('#', '') : '';
          var symbol = symbolId ? document.querySelector('symbol[id="' + symbolId + '"]') : null;
          var tintable = symbol && symbol.getAttribute('data-tintable') !== 'false';
          if (tintable) {
            svg.style.color = color;
          } else {
            svg.style.color = '';
          }
        });
      });
    });
    document.querySelectorAll('.icon-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var use = card.querySelector('use');
        var id = use.getAttribute('href').replace('#', '');
        var code = '<svg width="24" height="24"><use href="#' + id + '"><\\/use><\\/svg>';
        navigator.clipboard.writeText(code).then(function () {
          var label = card.querySelector('.icon-label');
          var orig = label.textContent;
          label.textContent = '✓ Copied!';
          label.style.color = '#059669';
          setTimeout(function () { label.textContent = orig; label.style.color = ''; }, 1500);
        });
      });
    });
  </script>
</body>
</html>`;
}
