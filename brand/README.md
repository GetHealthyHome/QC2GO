# Brand source artwork

The files supplied by the company, kept here rather than in `public/` because
they are **source**, not assets: nothing links to them and serving half a
megabyte nobody fetches is worse than keeping it out of the build. The files the
app actually uses are generated from these and live in `public/`.

## What these files actually are

They are named `.svg` and they are not vector art. Each one is an SVG wrapper
around **two embedded PNGs** — an RGB image and a greyscale alpha mask — at very
high resolution:

| File | Wrapper viewBox | Embedded raster |
| --- | --- | --- |
| `QC2GO.svg` | 770 × 257 | 3840 × 1282 |
| `QC2GO Tagline.svg` | 838 × 278 | 3840 × 1276 |
| `QC2GO Brandmark.svg` | 1150 × 1006 | 2470 × 2160 |

`QC2GO Tagline Update.png` is a plain 1888 × 656 PNG rather than a wrapper —
the corrected tagline, and the source for the sign-in lockup.

That is why a wordmark costs 216 KB. It also means the artwork does not scale
the way an SVG appears to promise — enlarge it far enough and it is a photograph
of a logo.

**The mask is not a cut-out.** Its alpha never falls below 64 and no pixel is
fully transparent, so the white behind the letters is part of the image. Placed
on the sign-in screen as supplied, the logo arrives as a white rectangle on
navy.

## What is generated from them

`public/qc2go-logo.png` (the wordmark, used in the header),
`public/qc2go-lockup.png` (the wordmark with its tagline, used on sign-in) and
the icon set are built from `QC2GO.svg`, `QC2GO Tagline Update.png` and
`QC2GO Brandmark.svg` by:

1. pulling the RGB raster out of the wrapper,
2. keying pure white (all channels ≥ 250) to transparent **at full
   resolution** — the grey "2" is `#bfbfbf` and nowhere near that threshold, so
   it survives untouched,
3. downscaling with Lanczos, which rebuilds the anti-aliased edge against
   transparency rather than against the white that was there before, and
4. quantising to a 64-colour palette, which takes the wordmark from 60 KB to
   under 10 KB because the artwork is four flat colours.

Doing the key *before* the downscale is what avoids a light fringe around every
letter. Keying after would leave one, at every size.

## Two things to fix at source

- **`QC2GO Tagline.svg` has a typo** — it reads **QUIALITY IN MOTION**. It is
  superseded by `QC2GO Tagline Update.png`, which is correct and is what
  `public/qc2go-lockup.png` is built from. The original is kept only so nobody
  re-exports from it by mistake.
- **No transparent export.** Everything above exists because every supplied
  file, the corrected one included, has a white background baked in. A PNG or
  SVG exported with transparency would let all of this be deleted, and would be
  better artwork besides.
