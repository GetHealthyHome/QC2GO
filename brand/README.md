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
the corrected tagline, on white.

`Logo with tagline no background.svg` is the same lockup **with real
transparency**: still a raster in a wrapper, but its mask runs the full 0–255
and 70% of the image is fully transparent. It is what `public/qc2go-lockup.png`
is built from, and nothing has to be keyed out of it.

That is why a wordmark costs 216 KB. It also means the artwork does not scale
the way an SVG appears to promise — enlarge it far enough and it is a photograph
of a logo.

**The mask is not a cut-out.** Its alpha never falls below 64 and no pixel is
fully transparent, so the white behind the letters is part of the image. Placed
on the sign-in screen as supplied, the logo arrives as a white rectangle on
navy.

## What is generated from them

`public/qc2go-lockup.png` (the wordmark with its tagline, used on sign-in) comes
straight out of `Logo with tagline no background.svg`: pull the raster and its
mask out of the wrapper, trim, downscale, quantise. No keying — the file is
already transparent.

`public/qc2go-logo.png` (the wordmark alone, used in the header) and the icon
set still come from `QC2GO.svg` and `QC2GO Brandmark.svg`, which are not, by:

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
- **The wordmark and brandmark still have no transparent export.** Only the
  tagline lockup has one, so only it skips the keying step. The same export from
  `QC2GO.svg` and `QC2GO Brandmark.svg` would let the rest of it go too.
