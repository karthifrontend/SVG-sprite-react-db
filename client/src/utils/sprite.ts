// Sprite utilities. Builds sprite XML, extracts symbols, validates SVG files, and formats sizes/dates.
export type SpriteSymbol = {
  id: string;
  viewBox: string;
  inner: string;
};

// Natural-order comparator for symbol ids so the live demo, downloaded sprite, and saved
// library version all list icons in a human-friendly sequence (`icon`, `icon-1`, `icon-2`,
// `icon-10` rather than the lexicographic `icon-1`, `icon-10`, `icon-2`). The id is split
// into alternating text / number runs; text segments are compared with `localeCompare` and
// number segments numerically. The `icon-` prefix is normalised away before the stem is
// compared so the rest of the name drives the ordering.
const ICON_PREFIX = "icon-";
export function compareSymbolId(a: string, b: string): number {
  if (a === b) return 0;
  const stripPrefix = (id: string): string =>
    id.toLowerCase().startsWith(ICON_PREFIX) ? id.slice(ICON_PREFIX.length) : id;
  const left = stripPrefix(a);
  const right = stripPrefix(b);
  const re = /(\d+)|(\D+)/g;
  const aParts: Array<{ num: number; text: string }> = [];
  const bParts: Array<{ num: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(left)) !== null) {
    aParts.push(m[1] !== undefined ? { num: parseInt(m[1], 10), text: "" } : { num: NaN, text: m[2] });
  }
  re.lastIndex = 0;
  while ((m = re.exec(right)) !== null) {
    bParts.push(m[1] !== undefined ? { num: parseInt(m[1], 10), text: "" } : { num: NaN, text: m[2] });
  }
  const len = Math.min(aParts.length, bParts.length);
  for (let i = 0; i < len; i += 1) {
    const ap = aParts[i];
    const bp = bParts[i];
    if (Number.isNaN(ap.num) && Number.isNaN(bp.num)) {
      const c = ap.text.localeCompare(bp.text, undefined, { numeric: true, sensitivity: "base" });
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
  // Coerce each element's id through `String(...)` so the comparator's
  // `(a: string, b: string) => number` signature is satisfied even if a
  // caller hands in a subtype whose `id` is wider than `string` (e.g. a
  // branded string alias). The cast is type-only at the call site and
  // has no runtime cost.
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
  fallbackIndex?: number
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

  // Concatenate all child nodes (element + text) into a single string.
  const inner = Array.from(svg.childNodes)
    .map(node => (node as Element).outerHTML ?? node.nodeValue ?? "")
    .join("")
    .trim();

  // Symbol id from filename. The sanitizer is the single source of truth for id formatting: it strips the extension, drops copy-suffixes, replaces bad characters, and prefixes `icon-` when the name doesn't already start with it.
  const id = sanitizeSymbolName(file.name);

  return { id, viewBox, inner };
}

// Build a complete sprite SVG document from a list of symbols.
export function buildSpriteXml(symbols: SpriteSymbol[]): string {
  const symbolsXml = symbols
    .map(s => `<symbol id="${s.id}" viewBox="${s.viewBox}">${s.inner}</symbol>`)
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
          .map((node) =>
            (node as Element).outerHTML ?? node.nodeValue ?? ""
          )
          .join("")
          .trim();
        return { id, viewBox, inner };
      })
      .filter((s): s is SpriteSymbol => s !== null);
  } catch {
    return [];
  }
}

// Build a self-contained HTML demo page that renders every symbol with <use>.
// The layout mirrors the on-screen live demo: centered header, color picker, a responsive grid of white cards (each with a rounded icon tile + monospace label) and a footer. Clicking a swatch re-tints every icon. Clicking a card copies a usage snippet to the clipboard.
export function buildDemoHtml(symbolIds: string[], spriteXml: string): string {
  const ids = symbolIds;
  const iconCards = ids.map(id => `
      <div class="icon-card">
        <div class="icon-preview">
          <svg width="40" height="40"><use href="#${id}"></use></svg>
        </div>
        <span class="icon-label">${id}</span>
      </div>`).join('');

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
  ${spriteXml}
  <div class="header">
    <h1>🎨 SVG Sprite Preview</h1>
    <p>${ids.length} symbol${ids.length !== 1 ? 's' : ''} in sprite.svg</p>
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
    // Normalize every symbol so all fill/stroke values use currentColor.
    // This guarantees that toggling the swatches re-tints every icon, even when
    // the original SVGs had hardcoded colors that the generator's regex missed
    // (e.g. styles set via the style attribute, single-quoted attributes, or
    // values inherited from wrapper <g> elements).
    (function normalizeSymbols() {
      var symbols = document.querySelectorAll('symbol');
      symbols.forEach(function (sym) {
        var nodes = sym.querySelectorAll('*');
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          // Skip text nodes and non-elements
          if (n.nodeType !== 1) continue;
          // Strip inline style fill/stroke (e.g. style="fill:#abc;stroke:#def")
          if (n.getAttribute('style')) {
            var s = n.getAttribute('style').replace(/(^|;)\s*(fill|stroke)\s*:\s*[^;]+/gi, function (match, p, prop) { return p + prop + ':currentColor'; });
            n.setAttribute('style', s);
          }
          // Force attribute-based fill/stroke to currentColor (except 'none').
          ['fill', 'stroke'].forEach(function (attr) {
            var v = n.getAttribute(attr);
            if (v && v !== 'none') {
              n.setAttribute(attr, 'currentColor');
            }
          });
          // For elements with no explicit fill/stroke and no style, set fill to currentColor
          // This ensures even basic shapes like circles, rects, lines get colored
          if (!n.getAttribute('fill') && !n.getAttribute('style')) {
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
        // Apply color to all SVGs in icon-preview divs by setting a CSS variable
        var style = document.getElementById('icon-color-style');
        if (!style) {
          style = document.createElement('style');
          style.id = 'icon-color-style';
          document.head.appendChild(style);
        }
        style.textContent = '.icon-preview svg { color: ' + color + ' !important; }';
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
