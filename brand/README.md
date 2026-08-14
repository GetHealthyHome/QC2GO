# Brand source artwork

The files supplied by the company, kept here rather than in `public/` because
they are **source**, not assets: nothing links to them and serving three-quarters
of a megabyte nobody fetches is worse than keeping it out of the build. The files
the app actually uses are generated from these and live in `public/`.

## What the app uses, and what it is built from

| Generated | Used by | Built from |
| --- | --- | --- |
| `public/qc2go-lockup.png` | The sign-in, set-password and no-company screens | `Logo with tagline no background.svg` |
| `public/qc2go-logo.png` | The header, once signed in | `qc2go transparent.png` |
| `public/favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | The browser tab, the home-screen icon, the PWA manifest | `Favicon or brandmark.svg` |

All three sources have **real transparency** — masks running the full 0–255,
around 70% of each image fully clear, every corner at alpha 0. Generating an
asset is now: pull the raster (and its mask, where the file is a wrapper), trim
the clear margin, downscale with Lanczos, quantise to 64 colours. The last step
matters more than it sounds: the artwork is four flat colours, and quantising
takes the wordmark from 60 KB to under 10 KB.

## These `.svg` files are not vector art

Each one is an SVG wrapper around **two embedded PNGs** — an RGB image and a
greyscale mask — at high resolution:

| File | Wrapper viewBox | Embedded raster |
| --- | --- | --- |
| `Favicon or brandmark.svg` | 1150 × 1006 | 1534 × 1342 |
| `Logo with tagline no background.svg` | 1416 × 492 | 1888 × 656 |
| `QC2GO.svg` | 770 × 257 | 3840 × 1282 |
| `QC2GO Tagline.svg` | 838 × 278 | 3840 × 1276 |
| `QC2GO Brandmark.svg` | 1150 × 1006 | 2470 × 2160 |

So a wordmark costs 216 KB, and the artwork does not scale the way an `.svg`
extension appears to promise — enlarge it far enough and it is a photograph of a
logo. Everything generated from them is a PNG, which is the honest form of it.

## The superseded originals

`QC2GO.svg`, `QC2GO Brandmark.svg`, `QC2GO Tagline.svg` and
`QC2GO Tagline Update.png` are the first round, and **all four have a white
background baked in** — alpha never falling below 64, every corner white. Dropped
onto a screen as supplied, each arrives as a white rectangle.

They were usable, by keying pure white to transparent at full resolution and
only then downscaling, so the resample rebuilt the anti-aliased edge against
transparency rather than against the white behind it. That code is gone now that
every asset has a transparent source. It is recorded here because the reasoning
is not obvious and would otherwise have to be rediscovered: keying *after* a
downscale leaves a light fringe around every letter, at every size.

Two reasons they are kept rather than deleted:

- **`QC2GO Tagline.svg` has a typo** — it reads **QUIALITY IN MOTION**. Keeping
  it named and explained is the surest way nobody re-exports from it by mistake.
- They are the only copies at 3840 px. Nothing needs that today.
