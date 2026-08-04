// Shared helper for the conflict modals. Mirrors the LiveDemo's
// "drop the whole sprite into a hidden SVG and render each card as
// <svg><use href="#id"></use></svg>" pattern, so the browser resolves
// the <use> reference against the live DOM 1:1.
//
// The previous approach (each conflict card did
// `<svg dangerouslySetInnerHTML={{__html: inner}} />`) broke the
// icon paint the same way it broke the LiveDemo before the port:
// raw inner content contains hardcoded `fill="#000"` /
// `stroke="#1C274C"` values that the browser renders literally, so
// the cards showed up as solid black blobs regardless of variant.
//
// The LiveDemo fix was to (1) drop the whole sprite XML into a hidden
// SVG-namespaced host, (2) render each card as a <use> reference
// against that host, and (3) drive the card's `color` attribute so
// `currentColor` (or `var(--icon-color, currentColor)`) inside the
// symbol resolves to the card colour. That same approach works here:
// the conflict modals already expose each conflict's `viewBox` and
// `inner` separately, so we re-wrap them as `<symbol>` elements on
// the fly, push them into the host, and render the cards with
// `<use href="#conflict-<id>">`.

import { useEffect } from "react";
import { classifySymbolVariant } from "../../utils/sprite";

const SVG_NS = "http://www.w3.org/2000/svg";
const HOST_ID = "conflict-sprite-host";
const STYLE_ID = "conflict-sprite-style";

export type ConflictSpriteInput = {
  id: string;
  viewBox: string;
  inner: string;
};

function makeSymbolElement(input: ConflictSpriteInput): SVGSVGElement {
  // Wrap the raw inner content in a <symbol> so the host has real
  // <symbol> elements the <use> references can resolve. The id is
  // namespaced with "conflict-" so it never collides with any user
  // symbol id that happens to be the same string.
  const wrapper = document.createElementNS(SVG_NS, "svg");
  wrapper.setAttribute("xmlns", SVG_NS);
  wrapper.innerHTML =
    `<symbol id="conflict-${input.id}" viewBox="${input.viewBox}">` +
    `${input.inner}` +
    `</symbol>`;
  return wrapper;
}

// Apply a per-element recolouring pass to the live host's <symbol>
// elements so the card's `color` attribute actually drives the icon
// paint. Mirrors the rule LiveDemo uses: paintable stroke + (none |
// missing) fill → stroke=currentColor, fill=none (outlined-only);
// paintable stroke + paintable fill → both currentColor (mixed
// outline + accent); paintable fill only → fill=currentColor,
// leftover stroke=none (solid); neither → default fill=currentColor
// so basic shapes (circle/rect/line) still render. Multicolor icons
// are left untouched.
function paintHostSymbols(host: SVGSVGElement): void {
  const parser = new DOMParser();
  host.querySelectorAll("symbol").forEach((sym) => {
    const inner = sym.innerHTML;
    const variant = classifySymbolVariant(inner);
    if (variant === "multicolor") return;
    const wrapped = `<svg xmlns="${SVG_NS}">${inner}</svg>`;
    const doc = parser.parseFromString(wrapped, "image/svg+xml");
    if (doc.querySelector("parsererror")) return;
    const root = doc.documentElement;
    root.querySelectorAll("*").forEach((el) => {
      const hasAttrFill = el.hasAttribute("fill");
      const hasAttrStroke = el.hasAttribute("stroke");
      const attrFill = el.getAttribute("fill") ?? "";
      const attrStroke = el.getAttribute("stroke") ?? "";
      const paintableFill = isPaintableValue(attrFill);
      const paintableStroke = isPaintableValue(attrStroke);
      if (variant === "outlined") {
        if (attrFill === "none") {
          if (paintableStroke) el.setAttribute("stroke", "currentColor");
        } else if (paintableFill) {
          el.setAttribute("fill", "none");
          el.setAttribute("stroke", "currentColor");
        } else if (paintableStroke) {
          el.setAttribute("stroke", "currentColor");
          el.setAttribute("fill", "none");
        }
      } else {
        // solid
        if (paintableFill && paintableStroke) {
          el.setAttribute("fill", "currentColor");
          el.setAttribute("stroke", "currentColor");
        } else if (paintableFill && !paintableStroke) {
          el.setAttribute("fill", "currentColor");
          if (hasAttrStroke) el.setAttribute("stroke", "none");
        } else if (paintableStroke && !paintableFill) {
          el.setAttribute("stroke", "currentColor");
          el.setAttribute("fill", "none");
        } else {
          if (!hasAttrFill) el.setAttribute("fill", "currentColor");
        }
      }
      const style = el.getAttribute("style");
      if (!style) return;
      let next = style;
      if (variant === "outlined") {
        if (paintableStroke) next = rewriteStyleDecl(next, "stroke", "currentColor");
        if (paintableFill) next = rewriteStyleDecl(next, "fill", "none");
      } else {
        if (paintableFill && paintableStroke) {
          next = rewriteStyleDecl(next, "fill", "currentColor");
          next = rewriteStyleDecl(next, "stroke", "currentColor");
        } else if (paintableFill) {
          next = rewriteStyleDecl(next, "fill", "currentColor");
          if (hasAttrStroke) next = rewriteStyleDecl(next, "stroke", "none");
        } else if (paintableStroke) {
          next = rewriteStyleDecl(next, "stroke", "currentColor");
          next = rewriteStyleDecl(next, "fill", "none");
        }
      }
      el.setAttribute("style", next);
    });
    const serialised = new XMLSerializer().serializeToString(root);
    const openTagEnd = serialised.indexOf(">");
    const closeTagStart = serialised.lastIndexOf("</svg>");
    if (openTagEnd < 0 || closeTagStart < 0) return;
    const newInner = serialised.slice(openTagEnd + 1, closeTagStart);
    // Replace the symbol's children in-place. We deliberately keep
    // the existing <symbol> element (with its viewBox + id) so the
    // <use href="#conflict-…"> references above continue to resolve.
    while (sym.firstChild) sym.removeChild(sym.firstChild);
    const fragment = document.createElementNS(SVG_NS, "svg");
    fragment.setAttribute("xmlns", SVG_NS);
    fragment.innerHTML = newInner;
    Array.from(fragment.childNodes).forEach((node) => {
      sym.appendChild(sym.ownerDocument!.importNode(node, true));
    });
  });
}

function isPaintableValue(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const v = value.trim();
  if (!v) return false;
  if (/^(none|transparent|currentcolor|inherit)$/i.test(v)) return false;
  if (v.toLowerCase().startsWith("url(")) return false;
  return true;
}

function rewriteStyleDecl(
  style: string,
  prop: "fill" | "stroke",
  value: string,
): string {
  const re = new RegExp(`(^|;)\\s*${prop}\\s*:\\s*[^;"]+`, "gi");
  return style.replace(re, (_match, lead) => `${lead}${prop}:${value}`);
}

// Effect hook that (a) builds/refreshes a hidden SVG sprite host
// containing one <symbol> per supplied input, (b) runs the
// per-element recolouring pass so the card's `color` attribute
// drives the icon paint, and (c) tears the host down on unmount or
// when the input list changes. The host lives at
// `document.getElementById("conflict-sprite-host")` and is shared
// across the conflict modals (they don't stack in the same DOM
// subtree at the same time in practice, but the singleton id
// matches LiveDemo's pattern and avoids accidental host
// duplication).
export function useConflictSpriteHost(inputs: ConflictSpriteInput[]): void {
  // Stable signature so the effect only re-runs when the
  // (id, viewBox, inner) tuples actually change — not on every
  // parent re-render. We intentionally key off the lengths, not
  // the inner content itself, because the inner can be many KB
  // per icon and comparing it on every render is wasteful. The
  // replaceChildren + recolour pass below does the authoritative
  // diff against the real DOM.
  const signature = inputs
    .map((i) => `${i.id}\u0000${i.viewBox}\u0000${i.inner.length}`)
    .join("|");
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (inputs.length === 0) {
      // Nothing to host — make sure any leftover host from a
      // previous mount is removed so the next open rebuilds from
      // scratch.
      const existing = document.getElementById(HOST_ID);
      if (existing) existing.remove();
      return;
    }
    let host = document.getElementById(HOST_ID) as SVGSVGElement | null;
    if (host && host.namespaceURI !== SVG_NS) {
      host.remove();
      host = null;
    }
    if (!host) {
      host = document.createElementNS(SVG_NS, "svg");
      host.setAttribute("id", HOST_ID);
      host.setAttribute("aria-hidden", "true");
      host.setAttribute("focusable", "false");
      host.style.cssText =
        "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;";
      document.body.appendChild(host);
    }
    host.replaceChildren();
    inputs.forEach((input) => {
      const wrapper = makeSymbolElement(input);
      Array.from(wrapper.childNodes).forEach((node) => {
        host!.appendChild(host!.ownerDocument.importNode(node, true));
      });
    });
    paintHostSymbols(host);
    // No scoped <style> needed — the per-element pass writes
    // `currentColor` directly on every paintable element, so the
    // card's `color="…"` attribute drives the paint without any
    // CSS. Strip any leftover <style> from a previous mount just
    // in case (e.g. a quick remount before cleanup fired).
    const staleStyle = document.getElementById(STYLE_ID);
    if (staleStyle) staleStyle.remove();
    return () => {
      const existing = document.getElementById(HOST_ID);
      if (existing) existing.remove();
      const style = document.getElementById(STYLE_ID);
      if (style) style.remove();
    };
    // signature is intentionally the only dep — it's derived from
    // inputs so a real change to any input triggers the rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
