-- ---------------------------------------------------------------------------
-- QC2GO — marks on a photo
--
-- A deficiency photo of a whole crawlspace with "rim joist left open at the
-- south wall" underneath asks the customer to find it themselves. An arrow
-- does not.
--
-- Stored beside the photo rather than burned into it. The original evidence
-- stays exactly as the camera produced it — an arrow drawn in the wrong place
-- can be moved, and nobody has to wonder whether the pixels underneath were
-- altered. It is also what the TRD's payload models: `annotations` as an array
-- on the attachment, not a second image.
--
-- Coordinates are fractions of the image, 0 to 1. A mark drawn on a phone has
-- to land in the same place in a report on a laptop and again on A4 paper, and
-- a fraction is the only number that survives all three.
--
--   [{ "id": "...", "kind": "arrow", "color": "red",
--      "points": [{"x":0.2,"y":0.4},{"x":0.6,"y":0.55}] }]
-- ---------------------------------------------------------------------------

alter table public.photos
  add column annotations jsonb not null default '[]'::jsonb;

comment on column public.photos.annotations is
  'Marks drawn over the photo, in normalised 0-1 coordinates. Never burned into '
  'the image — the stored bytes stay as the camera produced them. See 0010.';
