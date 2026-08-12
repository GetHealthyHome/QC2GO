-- ---------------------------------------------------------------------------
-- QC2GO — where and when a photo was actually taken
--
-- This is half a bug fix. Photos are downscaled through a canvas before they
-- reach storage, and canvas re-encoding discards EXIF entirely — so a QC2GO
-- photo carried *less* provenance than the raw file the camera produced. The
-- original capture time and any coordinates were destroyed on the way in,
-- before anything had a chance to read them.
--
-- The client now reads that metadata off the untouched file first and keeps it
-- as ordinary columns, where it can be queried, exported and eventually
-- geofenced against the job it belongs to.
--
-- `created_at` is when the record was made on the device. `taken_at` is when
-- the shutter fired. Those are usually seconds apart and occasionally days —
-- a photo picked out of the camera roll rather than taken on site is exactly
-- the case worth being able to see.
-- ---------------------------------------------------------------------------

alter table public.photos
  add column taken_at   timestamptz,
  -- {lat, lng}. Nullable because most phones strip location from the camera
  -- unless it has been turned on for it specifically.
  add column gps        jsonb,
  -- Whether the coordinates are the camera's claim about the photo, or this
  -- device's position when it was saved. Worth keeping apart: they answer
  -- slightly different questions and one is far easier to fake than the other.
  add column gps_source text,
  -- Whether the provenance was burned into the pixels. False when the browser
  -- could not decode the image and the original was kept whole.
  add column watermarked boolean not null default false;

alter table public.photos add constraint photos_gps_source_known
  check (gps_source is null or gps_source in ('exif', 'device'));

comment on column public.photos.taken_at is
  'When the shutter fired, from the file''s own metadata — not when the record '
  'was created. Read before the downscale, which destroys EXIF. See 0009.';

-- Photos with coordinates are the ones a geofence check can ever run against,
-- and they are a minority, so the index only carries those.
create index photos_located_idx on public.photos (org_id, taken_at desc)
  where gps is not null;
