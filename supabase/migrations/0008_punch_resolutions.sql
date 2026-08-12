-- ---------------------------------------------------------------------------
-- QC2GO — closing a punch item
--
-- A punch item is a failed checkpoint on a signed inspection. Marking one as
-- corrected is a thing that happens later, usually on a different visit, and
-- the obvious place to record it — a flag on the response inside the
-- inspection — is the one place it must not go.
--
-- A signed inspection is a record. The whole app is built on that: the
-- checklist is frozen into the record at the start so a later edit cannot
-- reword history, the server refuses edits to a completed inspection from
-- anybody but an admin, and unlocking one now leaves an entry in an append-only
-- ledger. Quietly rewriting a response inside a signed inspection to say
-- "fixed" would walk straight through all of it, and invisibly — the reopen
-- trigger only fires on a status change, so nothing would notice.
--
-- So a resolution is a new fact rather than an edit of an old one. It lives on
-- the customer, which is also where it belongs on its own merits: the punch
-- list is a per-customer view spanning every inspection, so its state sits at
-- that level rather than inside any one of them.
--
-- Keyed `<inspection_id>:<question_id>`:
--   { "insp_abc:q_12": { "at": "...", "by": "sam@co.test", "note": "..." } }
-- ---------------------------------------------------------------------------

alter table public.customers
  add column punch_resolutions jsonb not null default '{}'::jsonb;

comment on column public.customers.punch_resolutions is
  'Corrected punch items, keyed <inspection_id>:<question_id>. Held here rather '
  'than on the response so that signing an inspection makes it final — see 0008.';

-- Anyone in the company can already update a customer, which is the right
-- permission for this: closing out a punch item on a re-check is ordinary field
-- work, not an administrative override. No new policy needed.
