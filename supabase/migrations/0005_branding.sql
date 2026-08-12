-- ---------------------------------------------------------------------------
-- QC2GO — company branding
--
-- The printed report is the customer-facing document, and until now it was
-- headed with `settings.companyName`: a per-device value each inspector typed
-- in themselves. Two people on the same crew could hand out reports headed with
-- two different spellings of the company, and a new company using QC2GO had no
-- way to put its own mark on anything.
--
-- The name moves to the organization, and the logo joins it.
--
-- The logo is stored on the row as a data URL rather than in a storage bucket.
-- That is a deliberate trade against the usual advice, for one reason: this app
-- prints reports in crawlspaces. A bucket object needs a signed URL and a
-- network round trip to render, which is exactly what is missing at the moment
-- the report is produced. The organization travels with the profile at sign-in
-- and is cached on the device, so a data URL is on hand offline and a bucket
-- object is not.
--
-- The cost is a fat column. It is bounded below at 512 KB, and one logo per
-- company is nothing beside the thirty-odd photos a single inspection carries.
-- ---------------------------------------------------------------------------

alter table public.organizations add column logo text;

-- Belt and braces on what can land in the column. A logo is an image, it is a
-- data URL, and it is small: the client downscales to fit the report's slot
-- before encoding, so anything approaching this ceiling is a bug or an abuse
-- rather than a legitimate upload.
alter table public.organizations add constraint organizations_logo_is_small
  check (logo is null or length(logo) <= 524288);

alter table public.organizations add constraint organizations_logo_is_an_image
  check (logo is null or logo like 'data:image/%');

comment on column public.organizations.logo is
  'Company logo as an image data URL, sized for the report letterhead slot. '
  'Stored inline rather than in a bucket so it renders with no network — see 0005.';

-- Owners already hold the only write policy on this table
-- (`organizations_owner_update` in 0004), so the logo and the name are theirs
-- to change and nobody else''s. Nothing further to grant here.
