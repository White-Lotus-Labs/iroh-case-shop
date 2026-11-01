// A page is drawn once by the browser itself (SVG foreignObject), then every
// curl strip shows that one bitmap, as ThreeUI's strips show one picture.
const XHTML = 'http://www.w3.org/1999/xhtml';
const PAPER = '#f1eadb';
/** Text properties the page inherits from the book around it. */
const INHERITED = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'color',
  'letter-spacing',
  'word-spacing',
  '-webkit-font-smoothing',
  'font-optical-sizing',
  'font-kerning',
  'text-rendering',
];

const shots = new Map<string, string>();

/** Resolve in the browser's idle time, or soon if it never goes idle. */
export function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function')
      window.requestIdleCallback(() => resolve(), { timeout: 400 });
    else window.setTimeout(resolve, 16);
  });
}
const inlined = new Map<string, Promise<string>>();

export function pageShotKey(index: number, side: string, width: number) {
  return `${index}:${side}:${Math.round(width)}`;
}

export function getPageShot(key: string): string | undefined {
  return shots.get(key);
}

/** Revoke the shots baked at other widths, but not `keep`: a leaf may show one. */
export function prunePageShots(
  width: number,
  keep: Iterable<string | undefined>,
) {
  const held = new Set(keep);
  const tail = `:${Math.round(width)}`;
  for (const [key, url] of shots)
    if (!key.endsWith(tail) && !held.has(url)) {
      shots.delete(key);
      URL.revokeObjectURL(url);
    }
}

/** Strip pseudo-elements and states so a selector can be tested on the DOM. */
export function matchableSelector(selector: string): string {
  return (
    selector
      .replace(/::?(before|after|hover|focus-visible|focus|active)\b/g, '')
      .trim() || '*'
  );
}

/**
 * CSSOM reads a shorthand that holds `var()` as empty longhands, so
 * `cssText` drops it. Rebuild the declarations: use the shorthand's own text
 * when CSSOM kept it, else `resolve` (the computed style of a matched
 * element; the baker is hidden, so this is wrong for container units).
 */
export function declarations(
  style: CSSStyleDeclaration,
  resolve: (name: string) => string = () => '',
): string {
  const seen = new Set<string>();
  let body = '';
  for (let i = 0; i < style.length; i++) {
    let name = style[i];
    let value = style.getPropertyValue(name);
    for (let short = name; !value && short.lastIndexOf('-') > 0; ) {
      short = short.slice(0, short.lastIndexOf('-'));
      value = style.getPropertyValue(short);
      if (value) name = short;
    }
    value ||= resolve(name);
    if (!value || seen.has(name)) continue;
    seen.add(name);
    const important = style.getPropertyPriority(name) ? ' !important' : '';
    body += `${name}:${value}${important};`;
  }
  return body;
}

/** Ids named by `url(#id)` paints, such as a gradient kept in another svg. */
export function paintRefs(markup: string): string[] {
  return [
    ...new Set([...markup.matchAll(/url\(#([^)'"\s]+)\)/g)].map((m) => m[1])),
  ];
}

/** True when a `unicode-range` descriptor covers any of `codes`. */
export function coversAny(range: string, codes: Iterable<number>): boolean {
  if (!range.trim()) return true;
  const spans = range.split(',').map((part) => {
    const [lo, hi] = part.trim().replace(/^U\+/i, '').split('-');
    const from = parseInt(lo.replace(/\?/g, '0'), 16);
    const to = hi ? parseInt(hi, 16) : parseInt(lo.replace(/\?/g, 'F'), 16);
    return [from, to];
  });
  for (const code of codes)
    if (spans.some(([from, to]) => code >= from && code <= to)) return true;
  return false;
}

function sheetRules(sheet: CSSStyleSheet): CSSRuleList | null {
  try {
    return sheet.cssRules;
  } catch {
    return null;
  }
}

function pageCss(root: HTMLElement): string {
  const hit = (selector: string) => {
    for (const part of selector.split(',')) {
      try {
        const sel = matchableSelector(part);
        const el = root.matches(sel) ? root : root.querySelector(sel);
        if (el) return { el, pseudo: part.match(/::?(before|after)\b/)?.[0] };
      } catch {
        /* a selector the engine cannot test */
      }
    }
    return null;
  };
  const walk = (rules: CSSRuleList): string => {
    let out = '';
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const match = hit(rule.selectorText);
        if (!match) continue;
        let computed: CSSStyleDeclaration | undefined;
        const resolve = (name: string) =>
          (computed ??= getComputedStyle(
            match.el,
            match.pseudo,
          )).getPropertyValue(name);
        out += `${rule.selectorText}{${declarations(rule.style, resolve)}}`;
      } else if (rule instanceof CSSMediaRule) {
        // The SVG has its own viewport, so resolve media queries here.
        if (matchMedia(rule.conditionText).matches) out += walk(rule.cssRules);
      } else if (rule instanceof CSSContainerRule) {
        const inner = walk(rule.cssRules);
        if (inner) out += `@container ${rule.conditionText}{${inner}}`;
      } else if (rule instanceof CSSSupportsRule) {
        if (CSS.supports(rule.conditionText)) out += walk(rule.cssRules);
      }
    }
    return out;
  };
  let css = '';
  for (const sheet of document.styleSheets) {
    const rules = sheetRules(sheet);
    if (rules) css += walk(rules);
  }
  return css;
}

export function dataUrl(url: string): Promise<string> {
  let pending = inlined.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => {
        // An error page would inline as a broken font or picture.
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        return res.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      );
    pending.catch(() => inlined.delete(url));
    inlined.set(url, pending);
  }
  return pending;
}

const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, '');
const faceKey = (family: string, style: string) =>
  `${unquote(family)}|${style === 'normal' || !style ? 'normal' : 'italic'}`;

/** Web fonts do not reach an SVG image, so embed the faces the text uses. */
async function fontCss(root: HTMLElement): Promise<string> {
  const wanted = new Map<
    string,
    { weights: Set<number>; codes: Set<number> }
  >();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    let text = '';
    for (const n of el.childNodes)
      if (n.nodeType === Node.TEXT_NODE) text += n.textContent ?? '';
    if (!text.trim()) continue;
    const style = getComputedStyle(el);
    const key = faceKey(style.fontFamily.split(',')[0], style.fontStyle);
    const entry = wanted.get(key) ?? { weights: new Set(), codes: new Set() };
    entry.weights.add(Number(style.fontWeight) || 400);
    const shown =
      style.textTransform === 'uppercase' ? text.toUpperCase() : text;
    for (const ch of shown) entry.codes.add(ch.codePointAt(0) ?? 0);
    wanted.set(key, entry);
  }
  const faces: {
    rule: CSSFontFaceRule;
    href: string;
    key: string;
    weight: number;
  }[] = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheetRules(sheet) ?? []) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const s = rule.style;
      const key = faceKey(
        s.getPropertyValue('font-family'),
        s.getPropertyValue('font-style'),
      );
      const want = wanted.get(key);
      const src = s.getPropertyValue('src');
      if (!want || !src.includes('url(') || src.includes('local(')) continue;
      if (!coversAny(s.getPropertyValue('unicode-range'), want.codes)) continue;
      const weight = parseInt(s.getPropertyValue('font-weight'), 10) || 400;
      faces.push({ rule, href: sheet.href ?? location.href, key, weight });
    }
  }
  // Only the face nearest each weight the text asks for.
  const keep = new Set<CSSFontFaceRule>();
  for (const [key, want] of wanted) {
    const same = faces.filter((f) => f.key === key);
    for (const weight of want.weights) {
      const best = Math.min(...same.map((f) => Math.abs(f.weight - weight)));
      for (const f of same)
        if (Math.abs(f.weight - weight) === best) keep.add(f.rule);
    }
  }
  const css = faces
    .filter((f) => keep.has(f.rule))
    .map(async ({ rule, href }) => {
      const src = rule.style.getPropertyValue('src');
      const url = src.match(/url\(["']?([^"')]+)["']?\)/)?.[1] ?? '';
      const data = await dataUrl(new URL(url, href).href);
      return `@font-face{${declarations(rule.style)}}`.replace(
        /src:[^;]*;/,
        `src:url("${data}");`,
      );
    });
  return (await Promise.all(css)).join('');
}

/**
 * Draw a `.sb-page` (laid out or hidden) at `width` x `height` CSS px and
 * keep the bitmap. `imageUrl` picks the file for each <img> (its srcset choice).
 * Rejects, keeping nothing, when a font or picture fails to load.
 */
export async function bakePageShot(
  el: HTMLElement,
  key: string,
  width: number,
  height: number,
  imageUrl: (src: string) => string,
): Promise<string | null> {
  if (width < 8 || height < 8) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const [fonts, pictures] = await Promise.all([
    fontCss(el),
    Promise.all(
      [...el.querySelectorAll('img')].map((img) =>
        dataUrl(imageUrl(img.getAttribute('src') ?? '')),
      ),
    ),
  ]);
  await idle();
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('img').forEach((img, i) => {
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.removeAttribute('loading');
    img.src = pictures[i];
  });
  const outer = getComputedStyle(el.parentElement ?? el);
  const own = getComputedStyle(el);
  let style = `position:relative;width:${width}px;height:${height}px;`;
  for (const name of INHERITED)
    style += `${name}:${outer.getPropertyValue(name)};`;
  for (let i = 0; i < own.length; i++)
    if (own[i].startsWith('--'))
      style += `${own[i]}:${own.getPropertyValue(own[i])};`;
  const wrap = document.createElementNS(XHTML, 'div');
  wrap.setAttribute('style', style);
  const css = document.createElementNS(XHTML, 'style');
  css.textContent = fonts + pageCss(el);
  wrap.append(css, clone);
  // The SVG image cannot see the page, so bring outside paints along.
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  defs.setAttribute('style', 'position:absolute;width:0;height:0');
  for (const id of paintRefs(clone.innerHTML)) {
    const paint = document.getElementById(id);
    if (paint && !el.contains(paint)) defs.append(paint.cloneNode(true));
  }
  if (defs.childElementCount) wrap.append(defs);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width * dpr}" height="${height * dpr}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject width="${width}" height="${height}">${new XMLSerializer().serializeToString(wrap)}</foreignObject></svg>`;
  // A data: URL, not a blob: URL: Chromium taints the canvas for the latter.
  // Setting it lays out the SVG document at once, so give it its own slot.
  const img = new Image();
  await idle();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await img.decode();
    await idle();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const old = shots.get(key);
    if (old) URL.revokeObjectURL(old);
    shots.set(key, url);
    return url;
  } catch {
    // Tainted canvas or a failed decode: the leaf falls back to live pages.
    return null;
  }
}
