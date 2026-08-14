/**
 * How the app introduces itself: the full lockup, above whatever it is asking
 * for. Used by the three screens shown before there is an app to look at —
 * sign-in, setting a password, and the one that says you are in no company yet.
 *
 * The tagline is part of the artwork rather than text under it, because the
 * lockup is how the company draws its own name and the kerning of "QUALITY IN
 * MOTION" against the mark is a decision somebody made. The cost is that the
 * words cannot be translated or selected, which is why `alt` carries them.
 *
 * A PNG, not an SVG. The supplied artwork is a raster inside an SVG wrapper and
 * has its background baked in; `brand/README.md` covers what is generated from
 * it and why keying the white before downscaling is what avoids a fringe.
 */
export function BrandLockup() {
  return (
    <img
      src="/qc2go-lockup.png"
      alt="QC2GO — Quality in motion"
      width={760}
      height={224}
      className="mx-auto h-auto w-64 max-w-full"
    />
  );
}
