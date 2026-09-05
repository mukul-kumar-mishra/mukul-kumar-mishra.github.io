#!/usr/bin/env python3
"""Build themed site memes from raw cat character SVGs.

The cat files you drop in tool/cats/ keep YOUR original palette.
This tool maps every color to the site theme, wraps the character in
the standard meme chrome (title strip, wordmark, banner) and validates
the result against house rules (no banned patterns, no overflowing text).

Usage (run from the repo root):
  python tool/build_meme.py                 # build every meme in tool/memes.json
  python tool/build_meme.py --only NAME     # build one meme
  python tool/build_meme.py --check         # validate shipped memes, write nothing

Outputs land in images/articles/<name>.svg (or --outdir for tests).
"""
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TOOL = REPO / 'tool'
CATS = TOOL / 'cats'
SCENES = TOOL / 'scenes'
OUT = REPO / 'images' / 'articles'

# Original cat palette -> site theme. Keep your files in the LEFT column.
THEME = {
    '#252a31': '#0f172a',  # dark strokes -> ink
    '#171b21': '#0f172a',  # outlines -> ink
    '#11151b': '#0f172a',  # glasses/eyes -> ink
    '#303742': '#16a34a',  # hoodie/arms -> lime
    '#e5e7ea': '#ffffff',  # head -> white
    '#f5f6f7': '#ffffff',  # muzzle/shoes -> white
    '#f7f8f9': '#ffffff',  # t-shirt -> white
    '#e8eaed': '#ffffff',  # paw -> white
    '#bfc4ca': '#e6ebf2',  # hoodie opening -> line tint
    '#d4d7db': '#e6ebf2',  # strings -> line tint
    '#c9ced5': '#e6ebf2',  # laptop -> line tint
    '#c9a0a6': '#e11d48',  # inner ears -> hot
    '#c9828b': '#e11d48',  # nose -> hot
    '#000000': '#0f172a',  # black -> ink
    '#111318': '#0f172a',  # near-black -> ink
    '#2b303b': '#0f172a',  # dark slate -> ink
    '#777a80': '#475569',  # mid grey -> mist
    '#d7d7d7': '#e6ebf2',  # light grey -> line tint
    '#e98f8a': '#e11d48',  # salmon accent -> hot
    '#f5f5f5': '#ffffff',  # near-white -> white
    '#9299a2': '#475569',  # fur marks -> mist
    '#aeb4bc': '#475569',  # tail stripe -> mist
    '#737a83': '#475569',  # whiskers -> mist
    '#68717d': '#475569',  # question mark -> mist
}

CURSIVE = "'Segoe Script','Segoe Print','Comic Sans MS','Chalkboard SE',cursive"
SORA = "Sora, 'Segoe UI', Verdana, sans-serif"
MONO = "monospace"
INK, PAPER, LIME, HOT, MIST = '#0f172a', '#f8fafc', '#16a34a', '#e11d48', '#475569'


def theme_colors(svg_text):
    def repl(m):
        return THEME.get(m.group(0).lower(), m.group(0))
    return re.sub(r'#[0-9a-fA-F]{6}', repl, svg_text)


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def audit_cat(name):
    """Return a list of human-readable problems with a raw cat file."""
    raw = (CATS / name).read_text(encoding='utf-8')
    warns = []
    m = re.search(r'viewBox\s*=\s*"([^"]+)"', raw)
    vb = m.group(1).strip() if m else ''
    if vb != '0 0 100 100':
        warns.append(
            'viewBox is "%s", must be "0 0 100 100". The meme frame drops your art '
            'into a 100x100 box, so anything drawn on a bigger grid lands cropped, '
            'tiny, or off-canvas. Fix: scale the character to fill a 100x100 canvas '
            'and set width="100" height="100" viewBox="0 0 100 100".' % vb)
    xs, ys = [], []
    for d in re.findall(r'd="([^"]+)"', raw):
        nums = [float(x) for x in re.findall(r'-?\d+\.?\d*', d)]
        xs += nums[0::2]
        ys += nums[1::2]
    if xs and ys:
        w, h = max(xs) - min(xs), max(ys) - min(ys)
        if w < 50 or h < 70:
            warns.append(
                'art fills only ~%.0fx%.0f of the 100x100 box, so it renders small with '
                'dead space around it. Fix: scale the character to fill roughly '
                'x 20-95, y 10-95 like cat-confused.svg.' % (w, h))
    npaths = len(re.findall(r'[Mm]\s*[\d.]', raw))
    if npaths > 300:
        warns.append(
            '%d drawn subpaths: this looks auto-traced. Traced speckle renders as dirt '
            'and noise at meme size. Fix: delete background speckles and stray slivers, '
            'keep the character as <60 clean hand shapes like cat-confused.svg.' % npaths)
    fills = set(x.lower() for x in re.findall(r'(?:fill|stroke)\s*=\s*"(#[0-9a-fA-F]{6})"', raw))
    allowed = set(THEME) | set(THEME.values()) | {'#ffffff'}
    unmapped = sorted(f for f in fills if f not in allowed)
    if unmapped:
        warns.append(
            'unmapped colors ship raw and will clash with the theme: %s. Fix: reuse '
            'the exact palette of cat-confused.svg; the builder recolors automatically.' % ', '.join(unmapped))
    if re.search(r'<rect[^>]*width="100"[^>]*height="100"', raw):
        warns.append('full-canvas rect found: delete the background, memes supply their own.')
    return warns


def load_cat(name):
    raw = (CATS / name).read_text(encoding='utf-8')
    m = re.search(r'viewBox\s*=\s*"([^"]+)"', raw)
    if not m or m.group(1).strip() != '0 0 100 100':
        raise SystemExit('CAT VIEWBOX: %s must use viewBox="0 0 100 100" (see README, sending new expressions).' % name)
    for w in audit_cat(name):
        print('CAT WARN %s: %s' % (name, w))
    themed = theme_colors(raw)
    inner = re.sub(r'^.*?<svg[^>]*>', '', themed, count=1, flags=re.DOTALL)
    inner = re.sub(r'</svg>\s*$', '', inner, flags=re.DOTALL)
    return inner.strip()


def build(spec):
    x, y, w, h = spec['cat_xywh']
    cat_inner = load_cat(spec['cat'])
    scene = (SCENES / spec['scene']).read_text(encoding='utf-8').strip() if spec.get('scene') else ''
    sub = ''
    if spec.get('subtitle'):
        sub = '\n  <text x="60" y="156" font-family="%s" font-size="21" font-style="italic" fill="%s">%s</text>' % (CURSIVE, MIST, esc(spec['subtitle']))
    b1, b2 = spec['banner']
    return '\n'.join([
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680" role="img" aria-label="%s">' % esc(spec['aria']),
        '  <defs>',
        '    <filter id="roughen" x="-10%%" y="-10%%" width="120%%" height="120%%">'.replace('%%', '%'),
        '      <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="%d" result="n"/>' % spec.get('seed', 7),
        '      <feDisplacementMap in="SourceGraphic" in2="n" scale="6"/>',
        '    </filter>',
        '  </defs>',
        '  <rect x="0" y="0" width="1200" height="680" fill="%s"/>' % PAPER,
        '  <rect x="0" y="0" width="1200" height="680" fill="none" stroke="%s" stroke-width="6"/>' % INK,
        '  <rect x="0" y="0" width="1200" height="64" fill="%s"/>' % INK,
        '  <text x="36" y="41" font-family="%s" font-size="20" font-weight="bold" fill="%s">%s</text>' % (SORA, PAPER, esc(spec['strip'])),
        '  <text x="948" y="41" font-family="%s" font-size="24" font-weight="bold" fill="%s">Mukul<tspan dx="10" fill="%s">Mishra</tspan></text>' % (SORA, PAPER, LIME),
        '  <text x="60" y="130" font-family="%s" font-size="34" font-weight="bold" fill="%s">%s</text>' % (CURSIVE, INK, esc(spec['title'])),
        sub,
        '  <svg x="%d" y="%d" width="%d" height="%d" viewBox="%s">' % (x, y, w, h, spec.get('cat_viewbox', '0 0 100 100')),
        cat_inner,
        '  </svg>',
        scene,
        '  <rect x="60" y="540" width="1080" height="80" fill="%s"/>' % INK,
        '  <text x="90" y="591" font-family="%s" font-size="27" font-weight="bold" fill="%s">%s</text>' % (CURSIVE, PAPER, esc(b1)),
        '  <text x="%d" y="591" font-family="%s" font-size="27" font-weight="bold" fill="%s">%s</text>' % (spec['banner_x2'], CURSIVE, LIME, esc(b2)),
        '</svg>',
        '',
    ])


def check(svg_text, name):
    errs = []
    texts = re.findall(r'<text[^>]*>(.*?)</text>', svg_text, re.DOTALL)
    plain = ' '.join(re.sub(r'<[^>]+>', '', t) for t in texts)
    if ', and' in plain:
        errs.append('banned ", and" in text')
    if '—' in plain:
        errs.append('banned em dash in text')
    if re.sub(r'&[a-zA-Z]+;', '', plain).count(';'):
        errs.append('banned semicolon in text')
    for m in re.finditer(r'<text[^>]*x="([\d.]+)"[^>]*font-size="([\d.]+)"[^>]*>(.*?)</text>', svg_text, re.DOTALL):
        x, size, body = float(m.group(1)), float(m.group(2)), re.sub(r'<[^>]+>', '', m.group(3))
        mono = 'monospace' in m.group(0)
        est = x + len(body) * size * (0.60 if mono else 0.52)
        if est > 1160:
            errs.append('text overflows canvas: "%s..."' % body[:40])
    if 'Mukul<tspan' not in svg_text:
        errs.append('wordmark missing')
    if 'FIELD MEME' in svg_text:
        errs.append('old FIELD MEME tag still present')
    ET.fromstring(svg_text)  # raises if not well-formed
    return errs


def figure_snippet(spec):
    return ('<figure class="article-figure pm-meme"><img src="../images/articles/%s.svg" '
            'alt="%s" width="%d" height="%d"><figcaption>%s</figcaption></figure>'
            % (spec['name'], spec['alt'], spec.get('width', 1200), spec.get('height', 680), spec['caption']))


def main(argv):
    only = None
    outdir = OUT
    check_only = False
    audit_cats = False
    args = list(argv)
    while args:
        a = args.pop(0)
        if a == '--only':
            only = args.pop(0)
        elif a == '--outdir':
            outdir = Path(args.pop(0))
        elif a == '--check':
            check_only = True
        elif a == '--audit-cats':
            audit_cats = True
    if audit_cats:
        for f in sorted(CATS.glob('*.svg')):
            warns = audit_cat(f.name)
            print(('BAD ' if warns else 'ok  ') + f.name)
            for w in warns:
                print('      - ' + w)
        return
    specs = json.loads((TOOL / 'memes.json').read_text(encoding='utf-8'))['memes']
    if check_only:
        failed = False
        for f in sorted(OUT.glob('*.svg')):
            errs = check(f.read_text(encoding='utf-8'), f.name)
            print(('BAD ' if errs else 'ok  ') + f.name, errs or '')
            failed = failed or bool(errs)
        raise SystemExit(1 if failed else 0)
    for spec in specs:
        if only and spec['name'] != only:
            continue
        out = build(spec)
        errs = check(out, spec['name'])
        if errs:
            print('BLOCKED ' + spec['name'] + ':', errs)
            continue
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / (spec['name'] + '.svg')).write_text(out, encoding='utf-8')
        print('BUILT images/articles/%s.svg' % spec['name'])
        print('FIGURE: ' + figure_snippet(spec))


if __name__ == '__main__':
    main(sys.argv[1:])
