import { parseHTML } from "linkedom";
import { ApiError } from "../errors";

const allowed = new Set(
  "article section div p span h1 h2 h3 h4 h5 h6 header footer main aside nav figure figcaption img picture source video audio strong em b i u s strike del ins small mark sub sup abbr cite q time pre code kbd samp br hr wbr ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td a center font svg g defs path rect circle ellipse line polyline polygon text tspan lineargradient radialgradient stop clippath mask pattern use symbol title desc image".split(
    " ",
  ),
);
const discard = new Set(
  "script iframe object embed applet form input button textarea select noscript template canvas link base meta foreignobject animate animatetransform set".split(
    " ",
  ),
);
const voidTags = new Set(["img", "source", "br", "hr", "wbr", "col"]);
const sensitive =
  /^(access_token|token|api_key|secret|password|session|sessionid|pass_ticket|key|uin|exportkey)$/i;
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function safeUrl(raw: string, image = false): string | null {
  if (
    image &&
    /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(raw) &&
    raw.length < 400000
  )
    return raw;
  if (raw.startsWith("#")) return /^#[\w-]+$/.test(raw) ? raw : null;
  try {
    const u = new URL(raw.startsWith("//") ? "https:" + raw : raw);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      ![...u.searchParams.keys()].some((k) => sensitive.test(k))
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function css(raw: string) {
  if (
    raw.length > 100000 ||
    /expression\s*\(|-moz-binding|behavior\s*:|javascript\s*:|vbscript\s*:/i.test(
      raw,
    )
  )
    return "";
  return raw
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
      (_all, a, b, c) => {
        const u = safeUrl(String(a ?? b ?? c).trim(), true);
        return u ? `url("${u.replaceAll('"', "%22")}")` : "none";
      },
    );
}

/** Preserve source layout/images inside the reader's static sandbox. */
export function sanitizeReadingHtml(input: string) {
  if (input.length > 1500000)
    throw new ApiError("INVALID_ARGUMENT", "文章HTML超过大小限制。");
  const { document } = parseHTML(
    /<html[\s>]/i.test(input)
      ? input
      : "<!doctype html><html><body>" + input + "</body></html>",
  );
  const root =
    document.querySelector("#js_content, .rich_media_content") || document.body;
  let nodes = 0,
    mediaOmitted = false,
    images = 0;
  const text: string[] = [];
  function visit(node: Node, depth: number): string {
    if (++nodes > 50000 || depth > 160)
      throw new ApiError("INVALID_ARGUMENT", "文章结构过于复杂。");
    if (node.nodeType === 3) {
      text.push(node.textContent || "");
      return escape(node.textContent || "");
    }
    if (node.nodeType !== 1) return "";
    const el = node as Element,
      tag = el.tagName.toLowerCase();
    if (discard.has(tag)) {
      if (tag === "iframe") mediaOmitted = true;
      return "";
    }
    if (tag === "style")
      return (
        "<style>" +
        css(el.textContent || "").replaceAll("<", "\\3c ") +
        "</style>"
      );
    const out = allowed.has(tag) ? tag : "div";
    let attrs = "";
    for (const key of [
      "id",
      "class",
      "style",
      "title",
      "alt",
      "width",
      "height",
      "colspan",
      "rowspan",
      "align",
      "valign",
      "bgcolor",
      "color",
      "face",
      "size",
      "dir",
      "lang",
      "viewBox",
      "xmlns",
      "d",
      "fill",
      "stroke",
      "stroke-width",
      "transform",
      "points",
      "x",
      "y",
      "x1",
      "y1",
      "x2",
      "y2",
      "cx",
      "cy",
      "r",
      "rx",
      "ry",
      "offset",
      "stop-color",
      "stop-opacity",
      "gradientUnits",
      "gradientTransform",
      "preserveAspectRatio",
      "clip-path",
    ]) {
      let value = el.getAttribute(key);
      if (value === null || value.length > 15000) continue;
      if (["style", "fill", "stroke", "clip-path"].includes(key))
        value = css(value);
      attrs += ` ${key}="${escape(value)}"`;
    }
    if (tag === "a") {
      const u = safeUrl(el.getAttribute("href") || "");
      if (u)
        attrs += ` href="${escape(u)}" target="_blank" rel="noopener noreferrer nofollow"`;
    }
    if (tag === "img" || tag === "source") {
      const u = safeUrl(
        el.getAttribute("data-src") ||
          el.getAttribute("data-original") ||
          el.getAttribute("src") ||
          "",
        true,
      );
      if (!u) {
        mediaOmitted = true;
        return "";
      }
      attrs += ` src="${escape(u)}" referrerpolicy="no-referrer"`;
      if (tag === "img") {
        attrs += ` loading="${images++ < 3 ? "eager" : "lazy"}" decoding="async"`;
        const w = Number(el.getAttribute("data-w")),
          ratio = Number(el.getAttribute("data-ratio"));
        if (!el.hasAttribute("width") && w > 0 && w <= 10000)
          attrs += ` width="${w}"`;
        if (
          !el.hasAttribute("height") &&
          w > 0 &&
          ratio > 0 &&
          w * ratio <= 30000
        )
          attrs += ` height="${Math.round(w * ratio)}"`;
      }
    }
    if (tag === "use" || tag === "image") {
      const u = safeUrl(
        el.getAttribute("href") || el.getAttribute("xlink:href") || "",
        true,
      );
      if (u) attrs += ` href="${escape(u)}"`;
    }
    if (tag === "video" || tag === "audio") {
      const u = safeUrl(el.getAttribute("src") || "");
      if (u) attrs += ` src="${escape(u)}"`;
      const poster = safeUrl(el.getAttribute("poster") || "", true);
      if (poster) attrs += ` poster="${escape(poster)}"`;
      attrs += ' controls preload="none"';
    }
    if (voidTags.has(out)) return `<${out}${attrs}>`;
    const children = Array.from(node.childNodes)
      .map((n) => visit(n, depth + 1))
      .join("");
    if (["p", "div", "section", "li", "tr"].includes(out)) text.push("\n");
    return `<${out}${attrs}>${children}</${out}>`;
  }
  const styles = Array.from(document.querySelectorAll("style"))
    .filter((n) => !root.contains(n))
    .map((n) => visit(n, 0))
    .join("");
  const body =
    root === document.body
      ? Array.from(root.childNodes)
          .map((n) => visit(n, 0))
          .join("")
      : visit(root, 0);
  const html = (styles + body).trim(),
    plain = text.join("").replace(/\s+/g, " ").trim();
  if (!plain && !images)
    throw new ApiError("INVALID_ARGUMENT", "没有可展示的文章内容。");
  if (new TextEncoder().encode(html).length > 1500000)
    throw new ApiError("INVALID_ARGUMENT", "阅读HTML超过1.5MB。");
  return { html, summary: plain.slice(0, 200), mediaOmitted };
}
