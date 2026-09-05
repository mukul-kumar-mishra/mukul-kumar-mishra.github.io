# Meme pipeline: how to feed the machine

## Where things live

- `tool/cats/cat-<expression>.svg` — RAW cat files. Your palette, your lines.
- `tool/scenes/<name>.svg` — scene snippet for a meme (panels, props). Authored once per article.
- `tool/memes.json` — one entry per finished meme (cat + scene + texts).
- `tool/build_meme.py` — themes the cat, wraps everything in site chrome, validates, writes to `images/articles/`.

## Sending new expressions (precise spec)

1. **File**: drop into `tool/cats/` named `cat-<expression>.svg`, all lowercase, hyphens only.
   Example: `cat-furious.svg`, `cat-devastated.svg`, `cat-shocked.svg`.
2. **Canvas**: `viewBox="0 0 100 100"` exactly. Keep the character inside
   roughly x 20–95, y 10–95 (same bounding box as `cat-confused.svg`)
   so every scene frame stays composed.
3. **Palette**: use the EXACT original colors from `cat-confused.svg`
   (`#252A31` strokes, `#303742` hoodie, `#E5E7EA` head, `#C9A0A6` inner
   ears, `#C9828B` nose, `#737A83` whiskers, etc.). Do NOT pre-theme.
   The builder maps each hex to the site palette automatically.
4. **Strokes**: keep the same weights as the confused baseline (outlines
   ~1.5–1.7, limbs 6–7, details 0.7–2). Same pen, same hand.
5. **No text** inside cat files. Titles, banners and labels come from
   `memes.json`, set in site fonts by the builder.
6. **Accessories are fine** (whistle, hard hat, tear drop, motion ticks)
   drawn in ink (`#171B21`) — they theme to ink automatically.

## Which expressions to send (priority order, each maps to articles)

1. `cat-furious.svg` — angled brows, snarl mouth. Powers cursor-spacex (forced Grok rage).
2. `cat-devastated.svg` — X eyes, wail mouth, tear drop. Powers sandbox moderator.
3. `cat-shocked.svg` — O eyes, O mouth. Powers perplexity bill AND outage stranded (one file, two memes).
4. `cat-smug.svg` — half-lid eyes, smirk. Powers cellbased architect AND sandbox-breakout agent (one file, two memes).
5. `cat-exhausted.svg` — half-moon lids, under-eye bags, flat mouth. Powers replit retry.
6. `cat-dizzy.svg` — X or spiral eyes, wavy mouth. Powers cursor goldfish.
7. `cat-stern.svg` — flat brow, narrowed eyes. Powers figma referee.
8. `cat-panicked.svg` — wide eyes, big wail, paws up. Powers notion flood.
9. `cat-gleeful.svg` — happy arc eyes, big grin. Powers agentflayer presenter.
10. `cat-bored.svg` — flat line eyes and mouth. Powers vercel waiting.

Send any 4–5; the top of the list unlocks the most articles first.

## If the builder rejects your file (traced artwork)

Run `python tool/build_meme.py --audit-cats` first. It reports exactly
what is wrong. The usual failure is an auto-traced file: wrong grid
(`viewBox` must be `0 0 100 100`, not the tracer's 1254 canvas),
hundreds of speckle paths, and a foreign palette. A traced file cannot
be fixed automatically, so rework the source:

1. Crop to the character only. Delete the background, floor shadows,
   and every speckle sliver around the edges.
2. Scale the character to fill a 100x100 box (roughly x 20–95, y 10–95,
   same pose box as `cat-confused.svg`).
3. Reduce to clean hand paths (under 60). Merge speckle clusters into
   single shapes. If a zoomed view shows confetti, delete it.
4. Recolor with the exact `cat-confused.svg` palette. Unknown hex codes
   ship raw and will clash with the site theme.
5. Re-run `--audit-cats` until the file reports `ok`.

## Building

Run from the repo root:

    python tool/build_meme.py --only cursor-compaction-meme
    python tool/build_meme.py            # build everything in memes.json
    python tool/build_meme.py --check    # validate shipped memes, write nothing

The builder prints the exact `<figure>` HTML to paste into the article.
It refuses to write when house rules break (banned patterns, overflowing
text, missing wordmark, malformed XML).
