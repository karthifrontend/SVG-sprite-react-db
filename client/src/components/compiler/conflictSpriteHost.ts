// Shared helper for the conflict modals.

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
  const wrapper = document.createElementNS(SVG_NS, "svg");
  wrapper.setAttribute("xmlns", SVG_NS);
  wrapper.innerHTML =
    `<symbol id="conflict-${input.id}" viewBox="${input.viewBox}">` +
    `${input.inner}` +
    `</symbol>`;
  return wrapper;
}

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

export function useConflictSpriteHost(inputs: ConflictSpriteInput[]): void {
  const signature = inputs
    .map((i) => `${i.id}\u0000${i.viewBox}\u0000${i.inner.length}`)
    .join("|");
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (inputs.length === 0) {
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
    const staleStyle = document.getElementById(STYLE_ID);
    if (staleStyle) staleStyle.remove();
    return () => {
      const existing = document.getElementById(HOST_ID);
      if (existing) existing.remove();
      const style = document.getElementById(STYLE_ID);
      if (style) style.remove();
    };
  }, [signature]);
}
