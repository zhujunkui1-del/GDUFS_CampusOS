"""Reading HTML retains author styling and original image references, without media copies."""
from html.parser import HTMLParser
from html import escape
import re
from urllib.parse import urlsplit, parse_qsl

TAGS = set("article section div p span h1 h2 h3 h4 h5 h6 header footer main aside nav figure figcaption img picture source video audio strong em b i u s strike del ins small mark sub sup abbr cite q time pre code kbd samp br hr wbr ul ol li dl dt dd table caption colgroup col thead tbody tfoot tr th td a center font svg g defs path rect circle ellipse line polyline polygon text tspan lineargradient radialgradient stop clippath mask pattern use symbol desc image style".split())
DROP = set("script iframe object embed applet form input button textarea select noscript template canvas link base meta foreignobject animate animatetransform set title".split())
VOID = set("img source br hr wbr col input embed meta link".split())
ATTRS = set("id class style title alt width height colspan rowspan align valign bgcolor color face size dir lang viewbox xmlns d fill stroke stroke-width transform points x y x1 y1 x2 y2 cx cy r rx ry offset stop-color stop-opacity gradientunits gradienttransform preserveaspectratio clip-path data-w data-ratio".split())
SECRETS = {"access_token", "token", "api_key", "secret", "password", "session", "sessionid", "pass_ticket", "key", "uin", "exportkey"}


def safe_url(raw, image=False):
    if not isinstance(raw, str):
        return None
    if image and re.match(r"^data:image/(?:png|jpe?g|gif|webp|avif|svg\+xml)[;,]", raw, re.I) and len(raw) < 400000:
        return raw
    if re.fullmatch(r"#[\w-]+", raw):
        return raw
    try:
        value = urlsplit("https:" + raw if raw.startswith("//") else raw)
        if value.scheme == "https" and value.netloc and not value.username and not value.password and not any(k.lower() in SECRETS for k, _ in parse_qsl(value.query)):
            return value.geturl()
    except ValueError:
        pass
    return None


def safe_css(raw):
    if len(raw) > 100000 or re.search(r"expression\s*\(|-moz-binding|behavior\s*:|javascript\s*:|vbscript\s*:", raw, re.I):
        return ""
    def replace(match):
        value = safe_url(next((g for g in match.groups() if g is not None), "").strip(), True)
        return 'url("' + value.replace('"', '%22') + '")' if value else "none"
    return re.sub(r"url\(\s*(?:\"([^\"]*)\"|'([^']*)'|([^)]*))\s*\)", replace, re.sub(r"@import\s+[^;]+;?", "", raw, flags=re.I), flags=re.I)


class ReadingParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.stack = [], []
        self.skipping = self.text_size = self.nodes = self.images = 0
        self.media_omitted = False

    def handle_starttag(self, tag, attrs):
        self.nodes += 1
        if self.nodes > 50000 or len(self.stack) > 160:
            raise ValueError("BODY_STRUCTURE")
        skip = bool(self.skipping or tag in DROP)
        if tag == "iframe":
            self.media_omitted = True
        output = "" if tag in {"html", "head", "body"} or skip else tag if tag in TAGS else "div"
        values = dict(attrs)
        attributes = ""
        if output:
            for key, value in attrs:
                if key in ATTRS and value is not None and len(value) <= 15000:
                    if key in {"style", "fill", "stroke", "clip-path"}:
                        value = safe_css(value)
                    attributes += ' ' + key + '="' + escape(value, quote=True) + '"'
            if tag == "a":
                value = safe_url(values.get("href"))
                if value:
                    attributes += ' href="' + escape(value, quote=True) + '" target="_blank" rel="noopener noreferrer nofollow"'
            if tag in {"img", "source"}:
                value = safe_url(values.get("data-src") or values.get("data-original") or values.get("src"), True)
                if value:
                    attributes += ' src="' + escape(value, quote=True) + '" referrerpolicy="no-referrer"'
                    if tag == "img":
                        self.images += 1
                else:
                    output = ""
                    self.media_omitted = True
            if tag in {"video", "audio"}:
                for key in ("src", "poster"):
                    value = safe_url(values.get(key), key == "poster")
                    if value:
                        attributes += ' ' + key + '="' + escape(value, quote=True) + '"'
                attributes += ' controls preload="none"'
            if tag in {"use", "image"}:
                value = safe_url(values.get("href") or values.get("xlink:href"), True)
                if value:
                    attributes += ' href="' + escape(value, quote=True) + '"'
            if output:
                self.parts.append('<' + output + attributes + '>')
        if tag not in VOID:
            self.stack.append((tag, output, skip))
            self.skipping += skip

    def handle_endtag(self, tag):
        index = next((i for i in range(len(self.stack)-1, -1, -1) if self.stack[i][0] == tag), None)
        if index is None:
            return
        while len(self.stack) > index:
            _, output, skip = self.stack.pop()
            self.skipping -= skip
            if output and not skip:
                self.parts.append('</' + output + '>')

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        if not self.skipping:
            if self.stack and self.stack[-1][0] == "style":
                self.parts.append(safe_css(data).replace('<', '\\3c '))
            else:
                self.text_size += len(data.strip())
                self.parts.append(escape(data))


def reading_fragment(raw):
    if not isinstance(raw, str) or len(raw) > 1500000:
        raise ValueError("BODY_SIZE")
    parser = ReadingParser()
    parser.feed(raw)
    parser.close()
    while parser.stack:
        parser.handle_endtag(parser.stack[-1][0])
    fragment = ''.join(parser.parts).strip()
    if not parser.text_size and not parser.images:
        raise ValueError("NO_READING_CONTENT")
    if len(fragment.encode()) > 1500000:
        raise ValueError("BODY_SIZE")
    return fragment, parser.media_omitted
