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

  // Copy root presentation attributes onto a wrapping <g> so they're preserved
  // when the symbol is embedded. Original fill/stroke values are kept verbatim
  // so the generated sprite preserves each icon's intended colors — the
  // Live Demo's custom-CSS recolour step applies its own `!important`
  // overrides to the tintable (solid/outlined) icons, and the multicolor
  // variants are skipped there, so no information is lost by not
  // normalising the markup here.
  const groupAttributes: string[] = [];
  const ignoredAttributes = new Set([
    "id", "width", "height", "xmlns", "xmlns:xlink", "version", "class", "viewBox",
  ]);
  Array.from(svg.attributes).forEach((attribute) => {
    if (ignoredAttributes.has(attribute.name)) return;
    groupAttributes.push(` ${attribute.name}="${attribute.value}"`);
  });
  const inner = `<g${groupAttributes.join("")}>${svg.innerHTML}</g>`;

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
// either attributes or an inline `style` declaration).
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

// Kept available for callers that need the current artifact-cleaning helper;
// uploaded symbols use the legacy serialization path below for fidelity.
void stripUploadOnlyWrapperArtifacts;

// Build a complete sprite SVG document from a list of symbols.
// Matches legacy implementation: wraps symbols in <defs>, uses aria-hidden, and uses absolute positioning.
export function buildSpriteXml(symbols: SpriteSymbol[]): string {
  const symbolsXml = symbols
    .map(
      (s) => `<symbol id="${s.id}" viewBox="${s.viewBox}">${s.inner}</symbol>`,
    )
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width: 0; height: 0; position: absolute;">\n  <defs>\n  ${symbolsXml}\n</defs>\n</svg>`;
}

// Layout of the background-position sprite: square cells, `GRID_COLUMNS` per row. Each icon is scaled to fit an `GRID_ICON_SIZE` box centred in its cell, which leaves `(GRID_CELL_SIZE - GRID_ICON_SIZE) / 2` px of even spacing on every side.
const GRID_CELL_SIZE = 56;
const GRID_ICON_SIZE = 24;
const GRID_COLUMNS = 12;

const roundNum = (n: number): number => Math.round(n * 10000) / 10000;

function parseViewBox(viewBox: string): { minX: number; minY: number; w: number; h: number } {
  const parts = viewBox.trim().split(/[\s,]+/).map(Number);
  if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
    return { minX: parts[0], minY: parts[1], w: parts[2], h: parts[3] };
  }
  return { minX: 0, minY: 0, w: 24, h: 24 };
}

// ids defined inside one icon (gradients, clip paths, masks...) would collide with the same ids in other icons once every icon lives in a single document, so each icon's ids are namespaced with its symbol id.
function scopeInnerIds(inner: string, scope: string): string {
  const ids = new Set<string>();
  const idRegex = /\bid\s*=\s*(["'])(.*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = idRegex.exec(inner)) !== null) ids.add(m[2]);
  if (ids.size === 0) return inner;
  const escape = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = inner;
  ids.forEach((oldId) => {
    const next = `${scope}__${oldId}`;
    const e = escape(oldId);
    out = out
      .replace(new RegExp(`(\\bid\\s*=\\s*["'])${e}(["'])`, "g"), `$1${next}$2`)
      .replace(new RegExp(`url\\(\\s*(["']?)#${e}\\1\\s*\\)`, "g"), `url(#${next})`)
      .replace(new RegExp(`((?:xlink:)?href\\s*=\\s*["'])#${e}(["'])`, "g"), `$1#${next}$2`);
  });
  return out;
}

// Build a standalone "grid" sprite for CSS `background-position` usage: ONE <svg> holding every icon, laid out left-to-right in rows of `GRID_COLUMNS`. Each icon is a plain <g> (no nested <svg>): the outer group moves to the cell, the inner group scales the icon's viewBox uniformly to fit the icon box and centres it (so non-square or non-24px icons keep their proportions and stay aligned). Icon n sits at background-position `-(n % 6 * 48)px -(floor(n / 6) * 48)px`.
export function buildGridSpriteFromSymbols(symbols: SpriteSymbol[]): string {
  const count = symbols.length;
  const cols = Math.max(1, Math.min(GRID_COLUMNS, count));
  const rows = Math.max(1, Math.ceil(count / GRID_COLUMNS));
  const width = cols * GRID_CELL_SIZE;
  const height = rows * GRID_CELL_SIZE;
  const cells = symbols
    .map((sym, index) => {
      const x = (index % GRID_COLUMNS) * GRID_CELL_SIZE;
      const y = Math.floor(index / GRID_COLUMNS) * GRID_CELL_SIZE;
      const { minX, minY, w, h } = parseViewBox(sym.viewBox);
      const scale = GRID_ICON_SIZE / Math.max(w, h);
      const offsetX = (GRID_CELL_SIZE - w * scale) / 2 - minX * scale;
      const offsetY = (GRID_CELL_SIZE - h * scale) / 2 - minY * scale;
      const inner = scopeInnerIds(sym.inner, sym.id);
      return (
        `  <g id="${sym.id}" transform="translate(${x},${y})">` +
        `<g transform="translate(${roundNum(offsetX)},${roundNum(offsetY)}) scale(${roundNum(scale)})">${inner}</g>` +
        `</g>`
      );
    })
    .join("\n");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${cells}\n</svg>`
  );
}

// Convenience wrapper for the zip bundle: reads the compiled sprite XML and lays the icons out in `ids` order (the order shown in the demo / preview).
export function buildGridSpriteXml(spriteXml: string, ids: string[]): string {
  const byId = new Map(extractSymbolsFromSprite(spriteXml).map((s) => [s.id, s]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((s): s is SpriteSymbol => !!s);
  return buildGridSpriteFromSymbols(ordered);
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

// Which icon types custom CSS (solid color / gradient) may repaint.
//   Color enabled  -> "solid" | "outlined": Outline, Filled, Glyph, Monochrome, Rounded, Sharp. These icons are single-tone, so one custom color or gradient can replace their paint.
//   Color disabled -> "colored": Colored, Multicolor, Gradient, Brand, 3D, Isometric, Illustrative. These icons keep their original paint untouched.
// The type can't be read from the file directly, so it is inferred from the markup (see `classifySymbolVariant`).
export type IconVariant = "solid" | "outlined" | "colored";

// Paint values that do NOT carry a color of their own. `var(--icon-color, ...)` is what older versions of this app wrote into saved sprites in place of the real color, so it is treated as "no own color".
function isNeutralPaint(value: string): boolean {
  return (
    /^(none|transparent|currentcolor|inherit)$/i.test(value) ||
    /^var\(\s*--icon-color/i.test(value)
  );
}

function extractColorValues(markup: string): string[] {
  const values: string[] = [];
  const attrRegex = /\b(fill|stroke)\s*=\s*(['"])(.*?)\2/gi;
  const styleRegex = /\b(fill|stroke)\s*:\s*([^;"'\s]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(markup)) !== null) {
    const value = match[3]?.trim();
    if (!value) continue;
    if (isNeutralPaint(value)) continue;
    values.push(value);
  }

  while ((match = styleRegex.exec(markup)) !== null) {
    const value = match[2]?.trim();
    if (!value) continue;
    if (isNeutralPaint(value)) continue;
    values.push(value);
  }

  return values;
}

const ACHROMATIC_NAMES: Record<string, number> = {
  black: 0,
  dimgray: 105,
  dimgrey: 105,
  gray: 128,
  grey: 128,
  darkgray: 169,
  darkgrey: 169,
  silver: 192,
  lightgray: 211,
  lightgrey: 211,
  gainsboro: 220,
  whitesmoke: 245,
  white: 255,
};

// Reduce a paint value to a gray level (0-255) when it is black / white / a gray, or `null` when it is a real (chromatic) color or can't be understood. Unknown values deliberately return `null` so they are treated as colored and left untouched.
function grayLevelOf(raw: string): number | null {
  const v = raw.trim().toLowerCase();
  if (v in ACHROMATIC_NAMES) return ACHROMATIC_NAMES[v];
  let m = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length <= 4) hex = hex.replace(/./g, (c) => c + c);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return r === g && g === b ? r : null;
  }
  m = v.match(/^rgba?\(\s*([\d.]+)(%?)\s*[ ,]\s*([\d.]+)(%?)\s*[ ,]\s*([\d.]+)(%?)/);
  if (m) {
    const toByte = (n: string, pct: string): number =>
      Math.round(pct ? (parseFloat(n) / 100) * 255 : parseFloat(n));
    const r = toByte(m[1], m[2]);
    const g = toByte(m[3], m[4]);
    const b = toByte(m[5], m[6]);
    return r === g && g === b ? r : null;
  }
  m = v.match(/^hsla?\(\s*[\d.]+(?:deg)?\s*[ ,]\s*([\d.]+)%\s*[ ,]\s*([\d.]+)%/);
  if (m && parseFloat(m[1]) === 0) return Math.round((parseFloat(m[2]) / 100) * 255);
  return null;
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

// Elements that only appear in rich artwork (gradient / brand / 3D / isometric / illustrative icons), never in plain single-tone icons.
const RICH_ARTWORK_TAGS = /<(linearGradient|radialGradient|meshGradient|pattern|image|filter|feGaussianBlur|feDropShadow|feOffset|feColorMatrix)\b/i;

// Classify a symbol's inner markup. An icon is color-enabled only when it is single-tone:
//  - no gradients / patterns / images / filters (Gradient, Brand, 3D, Isometric, Illustrative),
//  - no chromatic fill or stroke (Colored), and
//  - at most ONE distinct black / white / gray paint (Multicolor and multi-shade art stay untouched).
// Icons that paint with `currentColor` or have no explicit paint at all (the typical Outline / Filled / Glyph / Rounded / Sharp icon) are color-enabled. Everything else is "colored" and keeps its original look.
export function classifySymbolVariant(markup: string): IconVariant {
  if (RICH_ARTWORK_TAGS.test(markup)) return "colored";

  const paints = extractColorValues(markup);
  if (paints.length > 0) {
    const levels = paints.map(grayLevelOf);
    if (levels.some((level) => level === null)) return "colored";
    if (new Set(levels).size > 1) return "colored";
  }

  const { fills, strokes } = countPaintableShapes(markup);
  if (strokes > 0 && strokes >= fills) return "outlined";
  // Line icons often set `fill="none"` and draw with an inherited stroke.
  if (fills === 0 && /\bfill\s*[=:]\s*['"]?none\b/i.test(markup)) return "outlined";
  return "solid";
}

export function isTintableSymbolMarkup(markup: string): boolean {
  return classifySymbolVariant(markup) !== "colored";
}

// Paint used by color-enabled icons in the DOWNLOADED sprite file. Page CSS can drive it with `color: ...` (falls back to currentColor) or with the `--icon-color` custom property.
const TINT_PAINT = "var(--icon-color, currentColor)";

// A fill / stroke value that carries an actual color (anything except none / transparent / inherit / url(...) / an existing var(...)).
function isRepaintableValue(raw: string): boolean {
  const v = raw.trim();
  if (!v) return false;
  if (/^(none|transparent|inherit)$/i.test(v)) return false;
  if (/^(url|var)\(/i.test(v)) return false;
  return true;
}

// Rewrite every `fill:` / `stroke:` declaration found in a CSS text (inline style attribute or <style> element).
function retintCssText(css: string): string {
  return css.replace(/\b(fill|stroke)(\s*:\s*)([^;}\n"]+)/gi, (match, prop: string, sep: string, value: string) =>
    isRepaintableValue(value) ? `${prop}${sep}${TINT_PAINT}` : match,
  );
}

// Make one color-enabled symbol follow CSS color: every explicit color paint becomes `var(--icon-color, currentColor)`, and (when `addDefaultFill`) the symbol gets it as its default fill so shapes with no paint, which would otherwise render black, follow it too. `none` fills/strokes, gradients and mask / clip content are left alone.
function tintSymbolElement(symbol: Element, addDefaultFill: boolean): void {
  const skip = new Set(["mask", "clippath"]);
  const visit = (el: Element): void => {
    const tag = el.tagName.toLowerCase();
    if (skip.has(tag)) return;
    if (tag === "style") {
      el.textContent = retintCssText(el.textContent ?? "");
    } else {
      for (const attr of ["fill", "stroke"]) {
        const value = el.getAttribute(attr);
        if (value !== null && isRepaintableValue(value)) el.setAttribute(attr, TINT_PAINT);
      }
      const style = el.getAttribute("style");
      if (style) el.setAttribute("style", retintCssText(style));
    }
    Array.from(el.children).forEach(visit);
  };
  Array.from(symbol.children).forEach(visit);

  if (addDefaultFill) {
    const doc = symbol.ownerDocument;
    const wrapper = doc.createElementNS(symbol.namespaceURI, "g");
    wrapper.setAttribute("fill", TINT_PAINT);
    while (symbol.firstChild) wrapper.appendChild(symbol.firstChild);
    symbol.appendChild(wrapper);
  }
}

// Sprite file for the download zip. Color-enabled icons (Outline, Filled, Glyph, Monochrome, Rounded, Sharp) are rewritten so CSS color works on them; color-disabled icons (Colored, Multicolor, Gradient, Brand, 3D, Isometric, Illustrative) are left exactly as they are. Returns the input unchanged when nothing needs rewriting or the XML can't be parsed. Used ONLY for the sprite file in the zip.
export function buildDownloadSpriteXml(spriteXml: string): string {
  if (!spriteXml) return spriteXml;
  try {
    const doc = new DOMParser().parseFromString(spriteXml, "image/svg+xml");
    if (doc.querySelector("parsererror")) return spriteXml;
    let changed = false;
    Array.from(doc.getElementsByTagName("symbol")).forEach((symbol) => {
      const inner = Array.from(symbol.childNodes)
        .map((node) => (node as Element).outerHTML ?? node.nodeValue ?? "")
        .join("")
        .trim();
      if (inner.includes("--icon-color")) return; // already prepared
      const variant = classifySymbolVariant(inner);
      if (variant === "colored") return;
      // Shapes with no paint of their own render black, so filled icons (and "outlined" ones that have no stroke at all) get the tint as their default fill. Elements that set `fill="none"` still win, being closer to the shape than the wrapper.
      const addDefaultFill = variant === "solid" || countPaintableShapes(inner).strokes === 0;
      tintSymbolElement(symbol, addDefaultFill);
      changed = true;
    });
    return changed ? new XMLSerializer().serializeToString(doc.documentElement) : spriteXml;
  } catch {
    return spriteXml;
  }
}

export function buildDemoHtml(symbolIds: string[], spriteXml: string): string {
  const ids = symbolIds;
  // Recolour type of every icon, from the same classifier the Live Demo uses. "solid" / "outlined" = color enabled (Outline, Filled, Glyph, Monochrome, Rounded, Sharp); "colored" = color disabled (Colored, Multicolor, Gradient, Brand, 3D, Isometric, Illustrative). Unknown icons are treated as color disabled so they are never altered.
  const iconVariants: Record<string, IconVariant> = {};
  extractSymbolsFromSprite(spriteXml).forEach((sym) => {
    iconVariants[sym.id] = classifySymbolVariant(sym.inner);
  });
  const variantOf = (id: string): IconVariant => iconVariants[id] ?? "colored";
  const iconVariantsJson = JSON.stringify(iconVariants)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
  const iconCards = ids
    .map(
      (id) => `
      <div class="icon-card">
        <div class="icon-preview">
          <svg width="40" height="40" data-icon-variant="${variantOf(id)}"><use href="#${id}"></use></svg>
        </div>
        <span class="icon-label">${id}</span>
      </div>`,
    )
    .join("");

  // Framework code samples embedded in the standalone demo page. Identical
  // content to `UserGuidePanel.tsx` so the downloaded demo offers the same
  // copy-paste snippets as the in-app guide. Keep `body` values as plain
  // strings here so the template literal below stays readable.
  const codeSamples: Record<string, { file: string; body: string }> = {
    html: {
      file: "index.html",
      body: [
        "<!-- 1. Paste sprite.svg at the top of <body> -->",
        "<body>",
        '  <svg aria-hidden="true" style="width: 0; height: 0; position: absolute;">',
        "    <!-- Sprite definitions, including gradients, go here -->",
        "  </svg>",
        "",
        "  <!-- 2. Use any icon anywhere -->",
        '  <svg class="icon" width="24" height="24">',
        '    <use href="#icon-home"></use>',
        "  </svg>",
        "",
        "  <!-- 3. Style with CSS (Including Gradients!) -->",
        "  <style>",
        "    .icon { color: #334155; }",
        "    .icon:hover { color: #4f46e5; }",
        "",
        "    /* Apply a gradient to an icon using the CSS variable */",
        "    .icon-gradient {",
        "      --icon-color: url(#grad-id);",
        "    }",
        "  </style>",
        "</body>",
      ].join("\n"),
    },
    react: {
      file: "Icon.jsx",
      body: [
        "// 1. Place sprite.svg in /public folder",
        "",
        "// 2. Create Icon component",
        "function Icon({ name, size = 24, className = \"\" }) {",
        "  return (",
        "    <svg",
        "      width={size}",
        "      height={size}",
        '      className={`icon ${className}`}',
        '      aria-hidden="true"',
        "    >",
        "      <use href={`/sprite.svg#${name}`} />",
        "    </svg>",
        "  );",
        "}",
        "",
        "// 3. Usage",
        '<Icon name="icon-home" size={32} />',
        '<Icon name="icon-search" className="text-blue-500" />',
        '<Icon name="icon-star" style={{ "--icon-color": "url(#grad-id)" }} />',
      ].join("\n"),
    },
    vue: {
      file: "SvgIcon.vue",
      body: [
        "<!-- 1. Place sprite.svg in /public folder -->",
        "",
        "<template>",
        "  <svg",
        "    :width=\"size\"",
        "    :height=\"size\"",
        '    class="svg-icon"',
        '    aria-hidden="true"',
        "  >",
        "    <use :href=\"`/sprite.svg#${name}`\" />",
        "  </svg>",
        "</template>",
        "",
        "<script setup>",
        "defineProps({",
        "  name: { type: String, required: true },",
        "  size: { type: Number, default: 24 }",
        "});",
        "</script>",
        "",
        "<!-- Usage:",
        "<SvgIcon name=\"icon-home\" :size=\"32\" />",
        "<SvgIcon name=\"icon-star\" style=\"--icon-color: url(#grad-id);\" />",
        "-->",
      ].join("\n"),
    },
    angular: {
      file: "svg-icon.component.ts",
      body: [
        "// 1. Place sprite.svg in /src/assets",
        "",
        "import { Component, Input } from '@angular/core';",
        "",
        "@Component({",
        "  selector: 'svg-icon',",
        "  standalone: true,",
        "  template: `",
        "    <svg [attr.width]=\"size\" [attr.height]=\"size\"",
        "         class=\"svg-icon\" aria-hidden=\"true\">",
        "      <use [attr.href]=\"'/assets/sprite.svg#' + name\">",
        "      </use>",
        "    </svg>",
        "  `,",
        "  styles: [`.svg-icon { display: inline-block; }`]",
        "})",
        "export class SvgIconComponent {",
        "  @Input() name = '';",
        "  @Input() size = 24;",
        "}",
        "",
        "// Usage:",
        "// <svg-icon name=\"icon-home\" [size]=\"32\"></svg-icon>",
      ].join("\n"),
    },
    svelte: {
      file: "Icon.svelte",
      body: [
        "<!-- 1. Place sprite.svg in /static folder -->",
        "",
        "<script>",
        "  export let name = '';",
        "  export let size = 24;",
        "</script>",
        "",
        "<svg",
        "  width={size}",
        "  height={size}",
        '  class="svg-icon"',
        '  aria-hidden="true"',
        ">",
        "  <use href={`/sprite.svg#${name}`} />",
        "</svg>",
        "",
        "<style>",
        "  .svg-icon { display: inline-block; color: inherit; }",
        "</style>",
        "",
        "<!-- Usage: <Icon name=\"icon-home\" size={32} /> -->",
      ].join("\n"),
    },
    nextjs: {
      file: "components/Icon.tsx",
      body: [
        "// 1. Place sprite.svg in /public folder",
        "",
        "interface IconProps {",
        "  name: string;",
        "  size?: number;",
        "  className?: string;",
        "}",
        "",
        "export default function Icon({",
        "  name,",
        "  size = 24,",
        "  className = \"\"",
        "}: IconProps) {",
        "  return (",
        "    <svg",
        "      width={size}",
        "      height={size}",
        "      className={`inline-block ${className}`}",
        '      aria-hidden="true"',
        "    >",
        "      <use href={`/sprite.svg#${name}`} />",
        "    </svg>",
        "  );",
        "}",
        "",
        "// Usage (App Router - Server Component safe):",
        "// <Icon name=\"icon-home\" size={32} />",
      ].join("\n"),
    },
  };

  // The supported framework tab ids. The matching labels are defined inside
  // the inline `buildPanelMarkup` function so the standalone demo can render
  // without depending on this variable.

  // Encode the code samples as a JSON blob so the inline script can render
  // them without us having to hand-build escaped HTML for every snippet.
  const codeSamplesJson = JSON.stringify(codeSamples)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");

  // The tab buttons / code panels are rendered by the inline script below
  // (it has access to `codeSamples` via the JSON blob), so we don't need to
  // pre-render them here.

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SVG Sprite Demo — ${ids.length} Symbols</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, sans-serif;
      background: #f8fafc;
      color: #334155;
      padding: 2rem;
      min-height: 100vh;
    }
    code, pre { font-family: 'JetBrains Mono', 'Fira Code', monospace; }
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

    /* --- Floating User Guide launcher --- */
    .guide-launcher {
      position: fixed; right: 24px; bottom: 24px; z-index: 60;
      width: 56px; height: 56px; border-radius: 50%;
      background: linear-gradient(135deg, #6366f1, #7c3aed);
      color: #fff; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 10px 25px rgba(99, 102, 241, 0.35), 0 4px 10px rgba(99, 102, 241, 0.2);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .guide-launcher:hover { transform: translateY(-2px) scale(1.05); box-shadow: 0 14px 30px rgba(99, 102, 241, 0.45); }
    .guide-launcher:active { transform: translateY(0) scale(0.98); }
    .guide-launcher svg { width: 24px; height: 24px; }

    /* --- User Guide side panel --- */
    .guide-overlay {
      position: fixed; inset: 0; z-index: 70;
      background: rgba(15, 23, 42, 0.5);
      backdrop-filter: blur(4px);
      animation: guide-fade 0.25s ease both;
    }
    .guide-panel {
      position: fixed; top: 0; right: 0; z-index: 80;
      height: 100%; width: 100%; max-width: 32rem;
      background: #fff; box-shadow: -10px 0 30px rgba(15, 23, 42, 0.18);
      display: flex; flex-direction: column;
      animation: guide-slide 0.3s ease-out both;
    }
    .guide-header {
      flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
      padding: 16px 24px;
      background: linear-gradient(90deg, #eef2ff, #f5f3ff);
      border-bottom: 1px solid #f1f5f9;
    }
    .guide-header-left { display: flex; align-items: center; gap: 12px; }
    .guide-header-icon {
      width: 36px; height: 36px; border-radius: 12px;
      background: linear-gradient(135deg, #6366f1, #7c3aed);
      box-shadow: 0 4px 10px rgba(99, 102, 241, 0.25);
      display: flex; align-items: center; justify-content: center; color: #fff;
    }
    .guide-header-icon svg { width: 20px; height: 20px; }
    .guide-header h2 { font-size: 1rem; font-weight: 700; color: #0f172a; line-height: 1.2; }
    .guide-header p { font-size: 11px; color: #94a3b8; }
    .guide-close {
      border: none; background: transparent; cursor: pointer;
      padding: 8px; border-radius: 8px; color: #94a3b8;
      transition: background 0.15s, color 0.15s;
    }
    .guide-close:hover { background: rgba(255, 255, 255, 0.6); color: #475569; }
    .guide-close svg { width: 20px; height: 20px; }

    .guide-body { flex: 1; overflow-y: auto; padding: 20px 24px 24px; }
    .guide-section { margin-bottom: 24px; }
    .guide-section-title {
      display: flex; align-items: center; gap: 10px; margin-bottom: 12px;
    }
    .guide-section-num {
      flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 800;
    }
    .guide-section-num.n1 { background: #e0e7ff; color: #4f46e5; }
    .guide-section-num.n2 { background: #d1fae5; color: #059669; }
    .guide-section-num.n3 { background: #ede9fe; color: #7c3aed; }
    .guide-section-num.n4 { background: #fef3c7; color: #d97706; }
    .guide-section h3 { font-size: 0.875rem; font-weight: 700; color: #1e293b; }
    .guide-section-body { margin-left: 36px; font-size: 13px; line-height: 1.6; color: #475569; }
    .guide-section-body p { margin-bottom: 10px; }
    .guide-section-body strong { color: #334155; }
    .guide-section-body code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 12px; border-radius: 4px;
      padding: 1px 6px; color: #4f46e5; white-space: nowrap;
    }
    .guide-section-body ul { list-style: none; padding: 0; }
    .guide-section-body li { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .guide-section-body li .li-icon {
      width: 20px; height: 20px; flex-shrink: 0; border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
    }
    .guide-section-body li .li-icon.indigo { background: #eef2ff; color: #6366f1; }
    .guide-section-body li .li-icon.emerald { background: #ecfdf5; color: #10b981; }
    .guide-section-body li .li-icon.rose { background: #fff1f2; color: #f43f5e; }
    .guide-section-body li .li-icon.amber { background: #fffbeb; color: #f59e0b; }
    .guide-section-body li .li-icon svg { width: 14px; height: 14px; }
    .guide-section-body li .li-text { color: #64748b; }
    .guide-section-body hr { border: none; border-top: 1px solid #f1f5f9; margin: 16px 0; }
    .guide-tip-card {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 10px; font-size: 12px; color: #475569; line-height: 1.55;
      margin-bottom: 8px; transition: background 0.15s, border-color 0.15s;
    }
    .guide-tip-card:hover { background: #f1f5f9; border-color: #cbd5e1; }
    .guide-tip-icon { font-size: 14px; line-height: 1.4; flex-shrink: 0; }
    .guide-tip-card code { font-family: 'JetBrains Mono', monospace; font-size: 11px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0 4px; color: #4f46e5; }
    .guide-tip-callout {
      margin-top: 10px; border: 1px solid #fde68a; background: #fffbeb;
      padding: 10px 14px; border-radius: 8px; font-size: 12px; color: #b45309;
    }
    .guide-tip-callout code { font-family: 'JetBrains Mono', monospace; background: rgba(255,255,255,0.7); padding: 0 4px; border-radius: 3px; }

    .guide-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 12px; }
    .guide-tab {
      font-size: 11px; font-weight: 600;
      padding: 5px 12px; border-radius: 8px;
      background: #f1f5f9; color: #64748b;
      border: 1px solid transparent; cursor: pointer;
      transition: background 0.15s, color 0.15s;
      line-height: 1.4;
    }
    .guide-tab:hover { background: #e2e8f0; color: #334155; }
    .guide-tab.active {
      background: linear-gradient(135deg, #6366f1, #7c3aed);
      color: #fff; border-color: transparent;
      box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
    }
    .guide-tab-panel { display: none; }
    .guide-tab-panel.active { display: block; animation: guide-fade-up 0.25s ease both; }
    .guide-code-block {
      border-radius: 12px; overflow: hidden;
      border: 1px solid #1e293b; background: #0f172a;
    }
    .guide-code-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 14px; background: #1e293b;
      border-bottom: 1px solid #334155;
    }
    .guide-code-header span {
      font-size: 11px; font-weight: 600; color: #94a3b8;
      font-family: 'JetBrains Mono', monospace;
    }
    .guide-copy-btn {
      font-size: 11px; font-weight: 600; color: #94a3b8;
      padding: 2px 8px; border-radius: 4px;
      background: transparent; border: 1px solid #334155;
      cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .guide-copy-btn:hover { background: #334155; color: #e2e8f0; }
    .guide-copy-btn.copied { background: #059669; color: #fff; border-color: #059669; }
    .guide-code-block pre {
      padding: 14px; margin: 0; overflow-x: auto;
      scrollbar-width: thin; scrollbar-color: #334155 transparent;
    }
    .guide-code-block pre::-webkit-scrollbar { height: 4px; }
    .guide-code-block pre::-webkit-scrollbar-thumb { background: #334155; border-radius: 999px; }
    .guide-code-block code {
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      font-size: 11px; line-height: 1.65; color: #a5f3fc; white-space: pre;
    }

    .guide-body::-webkit-scrollbar { width: 5px; }
    .guide-body::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }

    @keyframes guide-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes guide-slide {
      from { transform: translateX(100%); opacity: 0; }
      to   { transform: translateX(0);    opacity: 1; }
    }
    @keyframes guide-fade-up {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 640px) {
      .guide-panel { max-width: 100%; }
      .guide-launcher { right: 16px; bottom: 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
      }
    }
  </style>
</head>
<body>
  ${spriteXml}
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

  <button type="button" class="guide-launcher" id="guideLauncher" aria-label="Open user guide" title="User Guide">
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
    </svg>
  </button>

  <div id="guideRoot" hidden></div>

  <script id="guideCodeSamples" type="application/json">${codeSamplesJson}</script>
  <script id="iconVariants" type="application/json">${iconVariantsJson}</script>
  <script>
    (function () {
      // ----- Color buttons -----
      // Icons keep their original colors until a color is picked. A picked color is applied ONLY to color-enabled icons (solid / outlined); color-disabled icons ("colored": colored, multicolor, gradient, brand, 3D, isometric, illustrative) are never touched.
      var variantsNode = document.getElementById('iconVariants');
      var iconVariants = variantsNode ? JSON.parse(variantsNode.textContent) : {};
      var colorStyle = document.createElement('style');
      colorStyle.id = 'demoColorStyle';
      document.head.appendChild(colorStyle);

      function applyColor(color) {
        var rules = [];
        Object.keys(iconVariants).forEach(function (id) {
          var variant = iconVariants[id];
          if (variant === 'colored') return;
          var target = '[id=' + JSON.stringify(id) + '] *';
          rules.push(variant === 'outlined'
            ? target + ' { fill: none !important; stroke: currentColor !important; }'
            : target + ' { fill: currentColor !important; stroke: none !important; }');
        });
        colorStyle.textContent = rules.join(' ');
        document.querySelectorAll('.icon-preview svg').forEach(function (svg) {
          var enabled = svg.getAttribute('data-icon-variant') !== 'colored';
          svg.style.color = enabled ? color : '';
        });
      }

      document.querySelectorAll('.color-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('.color-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          applyColor(btn.getAttribute('data-color'));
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

      // ----- User Guide panel -----
      var samplesNode = document.getElementById('guideCodeSamples');
      var codeSamples = samplesNode ? JSON.parse(samplesNode.textContent) : {};
      var activeTab = 'html';
      var lastFocus = null;

      function escapeHtml(text) {
        return String(text)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
      }

      function buildPanelMarkup() {
        var tabs = ['html','react','vue','angular','svelte','nextjs'];
        var labels = { html:'HTML', react:'React', vue:'Vue', angular:'Angular', svelte:'Svelte', nextjs:'Next.js' };
        var tabsHtml = tabs.map(function (id) {
          return '<button type="button" class="guide-tab" data-tab="' + id + '">' + labels[id] + '</button>';
        }).join('');
        var panelsHtml = tabs.map(function (id) {
          return '<div class="guide-tab-panel" data-panel="' + id + '">' +
                   '<div class="guide-code-block">' +
                     '<div class="guide-code-header">' +
                       '<span data-file="' + id + '">' + (codeSamples[id] ? codeSamples[id].file : '') + '</span>' +
                       '<button type="button" class="guide-copy-btn" data-copy="' + id + '">Copy</button>' +
                     '</div>' +
                     '<pre><code data-code="' + id + '"></code></pre>' +
                   '</div>' +
                 '</div>';
        }).join('');

        return '' +
          '<div class="guide-overlay" id="guideOverlay" aria-hidden="true"></div>' +
          '<aside class="guide-panel" id="guidePanel" role="dialog" aria-modal="true" aria-label="User Guide">' +
            '<div class="guide-header">' +
              '<div class="guide-header-left">' +
                '<div class="guide-header-icon">' +
                  '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
                    '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>' +
                  '</svg>' +
                '</div>' +
                '<div>' +
                  '<h2>User Guide</h2>' +
                  '<p>Step-by-step instructions</p>' +
                '</div>' +
              '</div>' +
              '<button type="button" class="guide-close" id="guideClose" aria-label="Close guide">' +
                '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
                  '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>' +
                '</svg>' +
              '</button>' +
            '</div>' +
            '<div class="guide-body">' +
              '<section class="guide-section">' +
                '<div class="guide-section-title">' +
                  '<span class="guide-section-num n1">1</span>' +
                  '<h3>Upload SVG Icons</h3>' +
                '</div>' +
                '<div class="guide-section-body">' +
                  '<p>Choose <strong>Create New</strong> to build a fresh sprite from scratch, or <strong>Update Existing</strong> to add icons to an existing sprite file.</p>' +
                  '<p><strong>Drag &amp; drop</strong> your <code>.svg</code> files onto the upload zone, or click it to browse and select files.</p>' +
                  '<p>Review the staged files list and clear all before generating.</p>' +
                  '<div class="guide-tip-callout"><strong>💡 Tip:</strong> File names become symbol IDs. Use clean names like <code>arrow-right.svg</code>.</div>' +
                '</div>' +
              '</section>' +
              '<hr style="border:none;border-top:1px solid #f1f5f9;margin:16px 0">' +
              '<section class="guide-section">' +
                '<div class="guide-section-title">' +
                  '<span class="guide-section-num n2">2</span>' +
                  '<h3>What You Get</h3>' +
                '</div>' +
                '<div class="guide-section-body">' +
                  '<p>A <strong>ZIP bundle</strong> containing:</p>' +
                  '<ul>' +
                    '<li><span class="li-icon indigo"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg></span><code>sprite.svg</code><span class="li-text"> — Your compiled SVG sprite</span></li>' +
                    '<li><span class="li-icon emerald"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/></svg></span><code>demo.html</code><span class="li-text"> — Interactive preview page</span></li>' +
                    '<li><span class="li-icon amber"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/></svg></span><code>sprite-grid.svg</code><span class="li-text"> — icon grid (6 per row, padded) for CSS background-position</span></li>' +
                    '<li><span class="li-icon rose"><svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></span><code>sprite-preview.png</code><span class="li-text"> — Screenshot for docs/sharing</span></li>' +
                  '</ul>' +
                '</div>' +
              '</section>' +
              '<hr style="border:none;border-top:1px solid #f1f5f9;margin:16px 0">' +
              '<section class="guide-section">' +
                '<div class="guide-section-title">' +
                  '<span class="guide-section-num n3">3</span>' +
                  '<h3>Use in Your Code</h3>' +
                '</div>' +
                '<div class="guide-section-body">' +
                  '<p>Include the sprite in your HTML and reference icons with <code>&lt;use&gt;</code>.</p>' +
                  '<div class="guide-tabs">' + tabsHtml + '</div>' +
                  panelsHtml +
                '</div>' +
              '</section>' +
              '<hr style="border:none;border-top:1px solid #f1f5f9;margin:16px 0">' +
              '<section class="guide-section">' +
                '<div class="guide-section-title">' +
                  '<span class="guide-section-num n4">4</span>' +
                  '<h3>Pro Tips</h3>' +
                '</div>' +
                '<div class="guide-section-body">' +
                  '<div class="guide-tip-card"><span class="guide-tip-icon">🎨</span><span>Use <code>color: currentColor</code> in your CSS — icons inherit their parent\u2019s text color automatically.</span></div>' +
                  '<div class="guide-tip-card"><span class="guide-tip-icon">✨</span><span><strong>New: Gradients!</strong> Apply gradients to icons by setting <code>--icon-color: url(#grad-id)</code> in CSS. The generated sprite natively supports this!</span></div>' +
                  '<div class="guide-tip-card"><span class="guide-tip-icon">📐</span><span>Icons scale perfectly via <code>width</code> and <code>height</code> — they\u2019re vector, so no quality loss at any size.</span></div>' +
                  '<div class="guide-tip-card"><span class="guide-tip-icon">♿</span><span>Add <code>aria-hidden="true"</code> to decorative icons or <code>role="img"</code> + <code>aria-label</code> for meaningful ones.</span></div>' +
                  '<div class="guide-tip-card"><span class="guide-tip-icon">🔄</span><span><strong>"Update Existing"</strong> mode merges new symbols with the base sprite — duplicate ids are overwritten, existing ids preserved.</span></div>' +
                  '<div class="guide-tip-card"><span class="guide-tip-icon">⚡</span><span>One sprite file = one HTTP request for all icons. Far better performance than individual SVG or icon font files.</span></div>' +
                '</div>' +
              '</section>' +
            '</div>' +
          '</aside>';
      }

      function setActiveTab(id) {
        if (!codeSamples[id]) return;
        activeTab = id;
        var tabs = document.querySelectorAll('#guidePanel .guide-tab');
        var panels = document.querySelectorAll('#guidePanel .guide-tab-panel');
        tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === id); });
        panels.forEach(function (p) {
          var isActive = p.getAttribute('data-panel') === id;
          p.classList.toggle('active', isActive);
          if (isActive) {
            var codeEl = p.querySelector('[data-code]');
            if (codeEl && codeSamples[id]) codeEl.textContent = codeSamples[id].body;
          }
        });
      }

      function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve) {
          try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          } catch (e) { /* swallow */ }
          resolve();
        });
      }

      function openGuide() {
        var root = document.getElementById('guideRoot');
        if (!root) return;
        lastFocus = document.activeElement;
        root.innerHTML = buildPanelMarkup();
        root.hidden = false;
        document.body.style.overflow = 'hidden';

        // Wire interactions
        document.getElementById('guideOverlay').addEventListener('click', closeGuide);
        document.getElementById('guideClose').addEventListener('click', closeGuide);
        document.querySelectorAll('#guidePanel .guide-tab').forEach(function (btn) {
          btn.addEventListener('click', function () { setActiveTab(btn.getAttribute('data-tab')); });
        });
        document.querySelectorAll('#guidePanel [data-copy]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-copy');
            var sample = codeSamples[id];
            if (!sample) return;
            copyText(sample.body).then(function () {
              var orig = btn.textContent;
              btn.classList.add('copied');
              btn.textContent = 'Copied!';
              setTimeout(function () {
                btn.classList.remove('copied');
                btn.textContent = orig;
              }, 1500);
            });
          });
        });

        setActiveTab(activeTab);
        // Focus the close button for keyboard users
        var closeBtn = document.getElementById('guideClose');
        if (closeBtn) closeBtn.focus();
      }

      function closeGuide() {
        var root = document.getElementById('guideRoot');
        if (!root) return;
        root.hidden = true;
        root.innerHTML = '';
        document.body.style.overflow = '';
        if (lastFocus && typeof lastFocus.focus === 'function') {
          lastFocus.focus();
        } else {
          var launcher = document.getElementById('guideLauncher');
          if (launcher) launcher.focus();
        }
      }

      var launcher = document.getElementById('guideLauncher');
      if (launcher) launcher.addEventListener('click', openGuide);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && document.getElementById('guidePanel')) closeGuide();
      });
    })();
  </script>
</body>
</html>`;
}
