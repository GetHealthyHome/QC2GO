# Supabase backend

Sixteen migrations:

- **`0001_init.sql`** — tables, roles, row-level security, the photo storage
  bucket, and an office summary view.
- **`0002_customers.sql`** — renames `jobs` to `customers` and brings the schema
  in line with the app's model: no job name, job notes became the work scope, a
  customer carries its checklist ids and the GPS point captured on site, and an
  inspection carries the visit date it covers.
- **`0003_sync.sql`** — what the sync layer needs: somewhere to keep the
  salesperson and team-leader pick lists, tombstones so a delete on one device
  reaches another, and the indexes a pull actually reads.
- **`0004_organizations.sql`** — the tenancy boundary. Companies, one company
  per account, and every policy in the database narrowed from "is this person
  signed in?" to "is this row theirs?".
- **`0005_branding.sql`** — the company logo, so a report carries the mark of the
  company handing it over.
- **`0006_audit_log.sql`** — an append-only ledger, and the reason a signed
  inspection was unlocked.
- **`0007_stored_scores.sql`** — the result written down at sign-off, for
  everything outside the app that cannot derive it.
- **`0008_punch_resolutions.sql`** — closing out a punch item, recorded without
  touching the inspection that raised it.
- **`0009_photo_provenance.sql`** — when and where a photo was actually taken.
- **`0010_annotations.sql`** — marks drawn over a photo, stored beside it rather
  than burned into it.
- **`0011_webhooks.sql`** — telling somebody else an inspection finished.
- **`0012_repeatable_sections.sql`** — a section run once per head, zone or room.
- **`0013_report_shares.sql`** — a read-only link to a signed report, token
  stored hashed so the table is useless to whoever reads it.
- **`0014_tasks.sql`** — work orders: who is doing something about a deficiency,
  and the company's own answer to whether a second person has to verify it.
- **`0015_scheduling.sql`** — the timer for the two functions nobody calls by
  hand. Every statement in it is guarded, because it also has to be a no-op on
  the plain PostgreSQL the isolation suite runs against.
- **`0016_ai_usage.sql`** — a ceiling on what the AI features can cost a company
  in a day, and the only table a model call touches.

All sixteen are replayed end-to-end from an empty PostgreSQL 16 database on every
pull request, along with a two-company isolation suite — see
[Proving the boundary](#proving-the-boundary).

### Replayed in CI is not the same as applied to the project

A migration merges whether or not anything has run it against the live database,
and CI going green says only that it *would* apply cleanly to an empty one. The
failure that follows is quiet: the app keeps working, because nothing else reads
the new table, right up until somebody reaches the one feature that needed it —
which then fails looking like a broken feature rather than an unapplied
migration.

So before relying on a new migration, check that it is actually there. Each one
adds something nameable:

```sql
-- 0016, for example
select to_regprocedure('public.ai_take(text)');
```

`null` means it has not been applied. Apply it by pasting the file into **SQL
Editor**, or with `supabase db push`. Every migration here is written to be safe
to run twice — guarded `create ... if not exists`, `create or replace`, `drop
policy if exists` — so re-running one you were unsure about is not a risk.

## Setting it up

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the migrations in order, or with the CLI:
   `supabase link --project-ref <ref> && supabase db push`.
3. Under **Authentication → Providers**, confirm **Email** is enabled. Turn off
   "Confirm email" only if inspectors will be onboarded by hand.
4. Create the first company and its owner — see
   [Adding a company](#adding-a-company) below.
5. From **Project Settings → API**, note the project URL and the publishable
   (anon) key. Those are the two values the app will need.

Do not rename the migration files. The GitHub integration records each applied
version by filename; renaming `0001_init.sql` would make it look unapplied and it
would re-run against types that already exist.

## Organizations

Every row belongs to a company, and an account belongs to exactly one. That one
value — `profiles.org_id` — is the whole tenancy boundary: every policy in the
database is a comparison against it, and `current_org_id()` is the only thing any
of them needs to know.

It is deliberately a single scalar rather than a join. A join in a policy is a
place for a mistake to hide, and a mistake here is one company reading another's
inspection records.

**One company per account.** An inspector works for one company. Somebody who
needs to be in two needs two accounts, which is the honest representation of the
situation anyway. Moving to a memberships table later is mechanical; every policy
would swap one comparison for one `in (...)`.

**An account with no company sees nothing.** `org_id` is nullable, and every
policy compares against it — so for an uninvited account every comparison is
null, every table comes back empty, and the app says so on its own screen rather
than looking broken. That is the direction this fails in by design.

### Roles

| Role | Can |
| --- | --- |
| `owner` | Everything an admin can, plus inviting people and renaming the company. |
| `admin` | Author checklists, amend signed records, delete customers. |
| `inspector` | Run inspections, read every report in their own company. |

`owner` never appears in the app's local role picker: the rights it carries are
over other people's accounts, so it can only arrive from a signed-in profile.

### Adding a company

There is no self-serve signup — a company is created deliberately, in SQL:

```sql
insert into public.organizations (name, slug)
values ('Northeast Home Services', 'northeast-home')
returning id;
```

Then invite its owner:

```sql
insert into public.invites (org_id, email, role)
values ('<the org id>', 'owner@northeast-home.com', 'owner');
```

and create the account with that exact address under **Authentication → Users**.

**That is the only step you take.** From there the owner invites the rest of
their staff from **Settings → People** inside the app, and you are out of the
loop entirely.

### How an invitation works

An owner enters an address and a role. The `invite-user` Edge Function writes the
`invites` row and sends the email; following the link signs the account in and
the app asks for a password before anything else.

The signup trigger is what binds the two together: it reads any live invitation
for the new address, puts the profile in that company with that role, and marks
the invitation accepted. **No invitation means no company** — the account is
created and sees nothing, which is the safe direction to fail in.

Invitations expire after 14 days, and only one can be live per address at a time
across the whole platform, since an account belongs to one company. An expired
one is cleared out when the same address is invited again, rather than reported
as a conflict nobody can resolve.

## Edge Functions

`supabase/functions/` holds the server-side code.

| Function | JWT | Called by |
| --- | --- | --- |
| `invite-user` | required | an owner, from Settings → People |
| `shared-report` | **none** | anybody holding a share link, with no account |
| `deliver-webhooks` | required | `cron`, every minute |
| `sweep-photos` | required | `cron`, daily at 04:00 UTC |
| `ai-scribe` | required | an inspector, from a deficiency note |

`shared-report` is the only one deployed with `--no-verify-jwt`, and that is the
point of it: the recipient is a homeowner with a link, not a user. Everything it
will not disclose is decided explicitly in `access.ts` rather than by a policy,
because with the service key there is no policy underneath it.

### `deliver-webhooks`

Drains `webhook_deliveries`: posts each queued body to its endpoint with an
HMAC-SHA256 signature, records the result, and backs off on failure. Unlike
`invite-user` it takes no input from a caller and makes no decision about who
anything belongs to — it reads rows the database already wrote and posts them
where those rows say, so there is nothing a request body could influence.

```bash
supabase functions deploy deliver-webhooks
```

**It needs a schedule.** Every minute is right; nothing else invokes it. With
`pg_cron` and `pg_net` enabled:

```sql
select cron.schedule(
  'deliver-webhooks', '* * * * *',
  $$ select net.http_post(
       url     := 'https://<ref>.functions.supabase.co/deliver-webhooks',
       headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
     ); $$
);
```

Any external scheduler hitting the same URL works just as well, **as long as it
sends that `Authorization: Bearer <service-role-key>` header** — the function
now checks it. Without the check, the project's public anon key was enough to
drive delivery on demand and turn the endpoints on file into a reflected POST
flood. The cron snippet above already sends the right header, so it keeps
working unchanged; invoking it by hand needs the service-role key too. A
delivered row is still never selected again, so repeats are harmless.

Destinations are also checked before a request is made: a URL that resolves to
a private, loopback or link-local address — the cloud metadata endpoint, a
service on `127.0.0.1`, an internal range — is refused rather than fetched, and
a 3xx redirect is not followed onto such a host. `npm run check:webhook-ssrf`
asserts it.

### How a webhook is delivered

**The payload is built at the moment of completion and stored.** Not assembled
later from whatever the record says by then. An inspection can be reopened and
amended; the webhook has to describe what was true when it fired, and a delivery
retrying an hour later must send the body it was always going to send. The
migration suite asserts exactly this by changing the score afterwards and
checking the queued body did not move.

**Deliveries are a queue, not fire-and-forget.** The receiving end will be down
sometimes, and an event lost because somebody's server was restarting is worse
than no integration at all. Six attempts over about two and a half hours, with
the first retry quick and the last long.

**A 4xx is not retried.** It means the receiver understood and refused — a wrong
URL, a revoked token. Retrying that for two hours is noise on somebody else's
server. 408 and 429 are the exceptions: both explicitly mean "not now", which is
a different answer from "no".

**The body is signed.** `X-QC2GO-Signature: sha256=<hmac>` over the exact bytes
sent, using the endpoint's secret. A receiver that does not verify it is trusting
anybody who knows the URL.

The payload is the TRD's §5.2 shape rather than this app's own field names. The
moment it is easier to send the internal shape, the contract starts drifting.

### `invite-user`

The only part of QC2GO that runs with the `service_role` key — it needs the
admin API to send an invitation email, and that key bypasses row-level security
entirely. It must never reach a browser, which is why this runs on a server and
the client only asks.

Because the key bypasses RLS, nothing underneath the function catches a mistake
in it. Two habits guard against that:

1. **The caller is read back with their own token**, not the service key, so who
   they are and which company they are in is answered by the same policies that
   answer it everywhere else.
2. **The decision is a pure function** (`invite-user/authorize.ts`), tested
   directly by `npm run check:invite-authorization` — including the case that
   matters most, which is that a request body cannot name the company it is
   inviting into. The organization always comes from the caller's own profile
   row; a company named in a request is a claim with nothing behind it.

Deploy it, and set where its invitation links should land:

```bash
supabase functions deploy invite-user
supabase secrets set QC2GO_SITE_URL=https://your-deployment.vercel.app
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided
to the function automatically.

Without `QC2GO_SITE_URL` the invitation link points at Supabase's own default and
the person never reaches the app.

### `sweep-photos`

Bytes go to the bucket before the row that makes them findable, so that a row
never points at a file that is not there. The cost is the other direction: a row
upload that fails after the file has landed leaves the file behind, invisible to
the app and costing storage forever. This deletes those.

It is the only code in QC2GO that destroys evidence — no undo, no second copy on
the server — so what it will and will not delete lives in a pure function
(`sweep-photos/sweep.ts`) with four guards, each for a specific way this goes
wrong:

1. **A failed lookup is not an empty one.** "Could not read the photo rows" and
   "no rows reference these files" are different types, because treating the
   first as the second deletes the entire bucket on a transient error.
2. **Anything recent is left alone**, for seven days. A photo being synced right
   now has no row yet by definition.
3. **A bucket that looks mostly orphaned is refused** rather than swept. A real
   orphan rate is a rounding error; a half-read result set is a bug. The check
   is skipped below twenty aged objects, where the fraction means nothing.
4. **One run deletes at most 500**, and says how many it left behind, so a
   mistake that gets past everything above is bounded and visible before it is
   total.

`npm run check:sweep` asserts all of it.

```bash
supabase functions deploy sweep-photos
```

Run it once with `{"dryRun": true}` before scheduling it on a deployment that has
been running a while — it reports what it would collect and deletes nothing.
Then schedule it daily from the SQL editor; the cron snippet is in the header of
`sweep-photos/index.ts`.

Like `deliver-webhooks`, it now requires the caller to present the service-role
key as a bearer token — it is the one function that permanently deletes
evidence, and "any signed-in caller" includes anyone holding the public anon
key. The cron `net.http_post` sends that header already; a manual `dryRun`
invocation needs it too.

### `ai-scribe`

Cleans up one deficiency note when somebody asks it to. The first AI feature in
QC2GO and deliberately the smallest: one note in, a suggestion out, nothing
written to an inspection.

It needs `GEMINI_API_KEY`, which is set once and shared with `ai-checkpoints` —
see [The AI key](#the-ai-key) below.

Without it the function answers 503 and the app says the feature is not switched
on, which is a truthful description of a deployment that has not set it. Nothing
else stops working.

#### What stops it changing the report

A deficiency note is read by the homeowner, quoted on the work order, and
attached to a record somebody signs. The dangerous failure is not a clumsy
sentence — it is a rewrite that changes the claim:

> "no condensate trap" → "condensate trap installed incorrectly"

Both are grammatical, both are about the same equipment, and they accuse the
installer of different things. So `ai-scribe/fidelity.ts` throws away any
suggestion that

- lost a number, measurement, rating or serial that was in the original,
- gained one that was not,
- moved them into a different order, or
- flipped the note from denying something to asserting it, or back.

None of that needs an API key to test, and `npm run check:scribe` asserts every
case — including the ones that must still be *accepted*, because a gate that
refuses everything is a feature that does not ship.

The last check is a person: the suggestion appears next to what was typed, and
nothing changes until somebody presses **Use this**.

The checkpoint's own wording is deliberately *not* sent to the model. Every fact
put in front of it is a fact it can weave into a note the inspector did not
write, and the fidelity check cannot tell an imported fact from an invented one.

#### The bill

Every other endpoint here costs the same whether it is called ten times or ten
thousand. A model call does not, and the button that makes one sits on a text
field. `0016_ai_usage.sql` adds `ai_usage` and `ai_take()`, which claims one call
against the company's allowance for the day — 200, UTC — and refuses past it.
The claim and the check are a single statement, because reading the count and
then incrementing it is how two simultaneous calls both see the same number.

The limit is not a parameter. The function is reachable over PostgREST by
anybody signed in, and a limit passed in by the client being metered is not a
limit. Changing it takes a migration.

```bash
supabase functions deploy ai-scribe
```

### `ai-checkpoints`

Proposes checkpoints for one section of a checklist. An admin describes what the
section covers — "condensate and drainage on a ductless head" — and gets back a
handful of suggestions, each added or discarded on its own.

**This function writes nothing.** It has no `service_role` key and touches no
table but the meter. The section changes when an admin presses **Add** on a
suggestion, in the client, through the same store a hand-typed checkpoint goes
through.

Admins and owners only, checked against the caller's own profile row rather than
anything in the request. Editing a checklist is already an admin action in the
app, and an endpoint that spends the company's AI allowance should not be the
one place an inspector can reach past that.

#### What stops it inventing the standard

`ai-scribe` had an original to check its answer against: the note the inspector
typed. Generation has nothing of the kind, and no amount of checking turns a
proposed checkpoint into one that somebody with the equipment in front of them
wrote. So `ai-checkpoints/restraint.ts` does not try to decide whether a
checkpoint is *right*. It decides whether it is the model's place to say it.

The failure it is built around is not a badly worded question. It is a
threshold:

> "Verify total external static pressure is below 0.5 in. w.c."

That reads like the rest of the checklist and on many systems it is roughly
right. But it is a company standard arriving in a company's checklist with
nobody's decision behind it, and the inspector who meets it in the field will
score somebody's work against it.

**The model may propose what to check. It may not propose what passes.** Any
number in a suggestion that the admin did not put in their own description is
treated as invented, and the suggestion carrying it is thrown away — using the
same `facts()` that decides which numbers a tidied note may not change, so the
two features cannot drift apart on what counts as a number. "Record the measured
total external static pressure" survives; the sentence above does not.

Three smaller rules go with it. A suggestion already in the section is refused,
compared on stemmed significant words so that a rewording is caught as well as a
reordering. `critical`, `photoOnPass` and `informational` are never carried
across whatever the model sends — whether failing an item blocks sign-off is a
policy decision with a person behind it, one tap away in the editor. And how
many suggestions were discarded is shown rather than hidden, because a silent
gate looks like a model with no ideas and gets pressed again.

What it deliberately does not do is judge trade accuracy. A suggestion to check
a component this equipment does not have passes every rule here. That is why
nothing is written by this endpoint.

`npm run check:checkpoints` asserts every case, and needs no API key.

```bash
supabase functions deploy ai-checkpoints
```

### The AI key

Both AI features read one secret, in one place — `_shared/gemini.ts`. Nothing
else in the codebase reads it, which is what makes moving to a different Google
AI Studio account a change to a secret rather than a change to code.

**Getting a key**

1. Sign in at [aistudio.google.com](https://aistudio.google.com) with the Google
   account that should own the billing.
2. **Get API key** in the left sidebar → **Create API key**.
3. AI Studio associates the key with a Google Cloud project, creating one if the
   account has none. Keys minted here are *auth keys*, which is what you want —
   the Gemini API stopped accepting unrestricted standard keys in June 2026 and
   stops accepting standard keys altogether in September 2026.
4. Copy it once. AI Studio will not show it again.

**Installing it**

**Project Settings → Edge Functions → Secrets → Add new secret**

| Name | Value |
| --- | --- |
| `GEMINI_API_KEY` | the key from step 4 |

Then redeploy both functions, since a secret is read at invocation but a
function that has never been deployed cannot read anything:

```bash
supabase functions deploy ai-scribe
supabase functions deploy ai-checkpoints
```

The key never goes in the repository, in `.env`, or in a message to anybody. It
is in the Supabase secret store and in AI Studio, and those are the two places
it should exist.

**Moving to a different account**

The same three steps, in this order, so there is no window where the feature is
broken:

1. Mint a key on the new account.
2. Overwrite the `GEMINI_API_KEY` secret with it. Running functions pick it up
   on their next invocation; nothing needs redeploying for a value change.
3. Only then, delete the old key in the old account's AI Studio.

Doing (3) first gives you an outage between the delete and the update. The app
degrades honestly during one — 503, "not switched on" — but there is no reason
to have it.

Both features stop and start together, because they share the key. If they ever
need to be billed separately they need separate secrets, and `_shared/gemini.ts`
is the one file that would change.

### Scheduling

`deliver-webhooks` and `sweep-photos` are code nobody calls by hand, so until
something runs them they look exactly like features that do not work.
`0015_scheduling.sql` enables `pg_cron` and `pg_net` and creates both jobs — the
queue drain every minute, the sweep daily at 04:00 UTC.

**The credentials are deliberately not in the migration.** A cron job has to
authenticate to call a function, and the service-role key bypasses row-level
security entirely, so it is read from Vault at call time along with the
project's functions URL. Both jobs are written so that a missing secret means
they do nothing rather than failing every minute against a null header — set the
two secrets and they start working on their own.

The URL is plain configuration and can go in directly:

```sql
select vault.create_secret(
  'https://<project-ref>.supabase.co/functions/v1',
  'qc2go_functions_url'
);
```

The key is not, and it is worth storing it through a statement that checks
itself first:

```sql
do $$
declare
  key text := 'REPLACE_EVERYTHING_INSIDE_THESE_QUOTES';
begin
  if key !~ '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' then
    raise exception
      'Not a JWT — nothing was saved. Expected ~200+ chars with exactly two dots, got % chars.',
      length(key);
  end if;
  perform vault.create_secret(key, 'qc2go_service_role_key');
  raise notice 'Stored a %-character key.', length(key);
end $$;
```

Use `vault.update_secret((select id from vault.secrets where name = ...), key)`
in place of `create_secret` if the secret already exists.

**Why a validating block rather than a plain insert.** Vault will happily store
the example text, and every guard in the migration is about whether a secret
*exists* rather than whether it is any good — so a mis-paste is a job that runs
on time, authenticates with nonsense, and 401s once a minute in a table nobody
is watching. This version refuses at the point of pasting, where the person is
still looking. The first draft of these instructions used `'eyJ...PASTE_KEY...'`
as its placeholder, which passed its own "does it start with eyJ" check; that is
how this section came to exist.

The service-role key is the JWT-format one that starts `eyJ` — Project Settings
→ API Keys, under **Legacy API keys** if the project has moved to
`sb_publishable_` / `sb_secret_` keys. The functions gateway rejects anything it
cannot parse as a JWT with `UNAUTHORIZED_INVALID_JWT_FORMAT`.

### Is it actually working?

Two tables, and they answer different questions.

`cron.job_run_details` says whether the *job* ran. It reports `succeeded` even
when the request it made was refused, because sending the request is all the job
was asked to do:

```sql
select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
order by d.start_time desc limit 10;
```

`0 rows` means the job skipped itself because a secret is missing — the no-op,
not a failure. `1 row` means it posted.

`net._http_response` says what came back, and it is the only place a wrong key
shows up at all:

```sql
select status_code, left(content, 200) as body, created
from net._http_response order by id desc limit 5;
```

A healthy row is `200` with `{"considered":0,"delivered":0,"failed":0}`. A `401`
with `UNAUTHORIZED_INVALID_JWT_FORMAT` is the stored key; a `401` with
`UNAUTHORIZED_NO_AUTH_HEADER` means the Vault lookup came back empty.

One trap worth knowing, because it cost a round here: **Supabase pins `pg_net`
to the `net` schema** and silently ignores a `with schema` clause. A job body
that calls `extensions.http_post` is scheduled quite happily and then fails
every minute against a function that does not exist.

### One thing to check in the dashboard

Under **Authentication → URL Configuration**, add the deployment origin to
**Redirect URLs**. Supabase refuses to redirect anywhere not on that list, and
the failure looks like an invitation link that simply does not work.

### Branding

`organizations.logo` holds the company logo as an image data URL, and only an
owner can set it — the same `organizations_owner_update` policy that governs the
company name.

Storing an image inline rather than in a storage bucket is a deliberate trade
against the usual advice, for one reason: **this app prints reports in
crawlspaces**. A bucket object needs a signed URL and a network round trip to
render, which is exactly what is missing at the moment the report is produced.
The organization travels with the profile at sign-in and is cached on the device,
so a data URL is on hand offline and a bucket object is not.

The cost is a fat column, bounded by check constraints at 512 KB and to
`data:image/%`. The client downscales to the report's slot before encoding, so a
real logo lands far under that; anything approaching the ceiling is a bug or an
abuse. One logo per company is nothing beside the thirty-odd photos a single
inspection carries.

### Proving the boundary

`npm run check:migrations` applies every migration to a throwaway PostgreSQL and
then attempts, as one company, to read and write another's data — customers,
inspections, the user roster, the shared config, tombstones, and the photo
bucket. It also replays the path the live database will actually take: three
migrations, a company's worth of data, then the fourth, checking the data was
adopted rather than orphaned and that photo objects and the rows pointing at them
moved together.

This is the one kind of code where "it compiles" and "it is correct" are
furthest apart. A policy with a typo installs fine. A policy that admits every
signed-in caller installs fine. CI runs this on every pull request.

## How the schema is shaped

**`profiles`** extends `auth.users` with a company (`org_id`) and a `role` of
`owner`, `admin`, or `inspector`. A trigger creates the row on signup, reading
both from any pending invitation for that address, so promotion is
always a deliberate act. Policies read the role through
`current_role_is_admin()`, a `security definer` function — reading `profiles`
directly from inside a `profiles` policy would recurse.

**`customers`** is the organizing record — one project per customer. Every visit,
every checklist and every QC card hangs off it. `template_ids` is the set of
checklists chosen when the record was created; `location` is the GPS point
captured while standing at the property, which is what "projects near me" reads.
Addresses are never geocoded, so there is no network call on that path.

**`templates`** and **`shared_config`** hold the checklists. Everyone in the
company reads them; only its admins write. Both are keyed by company:
`shared_config` has one row per organization, and a checklist's primary key is
`(org_id, id)` rather than `id` alone. That last one matters more than it looks —
the shipped checklists carry fixed ids from code, so every company seeds its own
copies under the same ids, and a global key would give the second company to sync
a unique violation. The sync engine treats that as permanent, so the upload would
be abandoned and the company would silently have no checklists.

`inspections.template_id` carries no foreign key. The snapshot is the real
identity of the checklist, and the constraint was doing active harm: the sync
engine had to null the column out whenever a checklist had not reached the server
yet, purely to stop inspections failing to upload behind it.

**`customers.punch_resolutions`** records punch items corrected on a later
visit, keyed `<inspection_id>:<question_id>`. The obvious home for this — a flag
on the response inside the inspection — is the one place it must not go. A signed
inspection is a record, and quietly rewriting a response inside one to say
"fixed" would walk through every guarantee the app makes about that, invisibly:
the reopen trigger only fires on a status change, so nothing would notice.

A resolution is a new fact rather than an edit of an old one, and the customer is
where it belongs on its own merits — the punch list is a per-customer view
spanning every inspection, so its state sits at that level.

**`inspections.snapshot`** is the important one. Each inspection stores its own
frozen copy of the checklist — questions, sections, and info fields — as it stood
when the inspection began. An admin can reword a question or reorder a section
without altering a single signed record. Verified: after bumping a template to
version 2, the existing inspection still reports snapshot version 1.

**`photos.taken_at` / `gps` / `gps_source`** are where the photo says it came
from. `created_at` is when the record was made on the device; `taken_at` is when
the shutter fired, and the two are occasionally days apart — a photo picked out
of the camera roll rather than taken on site is exactly the case worth being able
to see. `gps_source` separates the camera's claim about the photo from this
device's position when it was saved; they answer slightly different questions and
one is far easier to fake.

**`photos.annotations`** holds the marks drawn over a photo — arrows, boxes,
freehand, labels — in coordinates normalised to 0–1. Never burned into the image:
the stored bytes stay exactly as the camera produced them, so an arrow in the
wrong place can be moved and nobody has to wonder whether the pixels underneath
were altered. Normalised coordinates are what let the same mark land in the same
place on a phone, in a report on a laptop, and on A4 paper.

**`photos`** indexes files in the private `inspection-photos` storage bucket,
keyed `<org_id>/<inspection_id>/<photo_id>.jpg`. The company comes first because
that is what the bucket policy reads — a caller may touch an object only when the
first path segment is their own company. Before `0004` the bucket had no tenancy
at all: the read policy admitted any signed-in caller to any object in it, so a
photo was one guessed path away from anybody with an account. The app reads
through signed URLs, so interior photos of customers' homes are never publicly
addressable either.

**`inspections.overall_score`, `pass_fail_status`, `total_deficiencies`** are the
result, written once at sign-off and null until then. Inside the app the score is
still derived from the responses on every read, which is right: the frozen
snapshot sits beside them, so the number cannot drift from what the inspection
said. These exist for everything that cannot run that code — a webhook body, a
spreadsheet export, a dashboard. Both are produced by the same function, so there
is one rule rather than two implementations free to disagree.

Reopening a signed record clears them. A verdict belongs to the sign-off that
produced it, and a reopened inspection does not have one.

**`inspection_summary`** is one row per inspection — the view to point a
dashboard or a Google Sheets mirror at. It reports the stored result and keeps
the raw pass/fail/N-A counts beside it. It used to derive pass and fail itself,
which quietly made it a second implementation of the scoring rule.

**`audit_log`** is where a signed inspection being unlocked is recorded. It is
append-only in the strongest sense the database offers: there is a select policy
and **no insert, update or delete policy at all**, so the only thing that can add
a row is a `security definer` trigger and nothing whatsoever can change or remove
one.

The reason itself is captured twice on purpose. `inspections.reopenings` holds it
on the record — writable offline, carried by the ordinary sync, and shown on the
report wherever it is read. The trigger copies each new entry into the ledger
when the change reaches the server. The first copy is the convenient one and the
second is the evidence.

**`tombstones`** records what was deleted, so a device that was offline at the
time finds out. Readable inside the company that owns the deleted row and
writable by nobody: the rows are written by a `security definer` trigger, and
there is deliberately no insert policy. The marker carries its company for the
same reason everything else does — an id on its own would tell one company the
identifiers of another's deleted records.

## Who can do what

Everything below is scoped to the reader's own company first. "Every" means
every one in that company, and there is no row anywhere that means every one in
the platform.

| | Inspector | Admin | Owner |
| --- | --- | --- | --- |
| Run inspections | ✅ | ✅ | ✅ |
| Read every completed report | ✅ | ✅ | ✅ |
| Create and edit customers | ✅ | ✅ | ✅ |
| Edit an inspection | own, while in progress | any | any |
| Reopen a signed inspection | ❌ | ✅ | ✅ |
| Create and edit checklists | ❌ | ✅ | ✅ |
| Delete customers | ❌ | ✅ | ✅ |
| Change roles | ❌ | ✅ | ✅ |
| Invite people | ❌ | see who is pending | ✅ |
| Rename the company | ❌ | ❌ | ✅ |
| See anything in another company | ❌ | ❌ | ❌ |

Inspectors read all their company's reports on purpose — recalling someone
else's past walkthrough on a return visit is a real need. Tighten
`inspections_select` if you want that scoped further.

## Linter warnings left standing

Supabase's database linter flags `current_role_is_admin()` and
`handle_new_user()` as `SECURITY DEFINER` functions reachable over the REST API.
Both are left as they are, deliberately:

- `current_role_is_admin()` takes no arguments and reports whether *you* are an
  admin. Revoking `execute` from `authenticated` would break every policy that
  calls it — a policy expression is evaluated with the caller's privileges, so
  the whole app would start returning permission errors.
- `handle_new_user()` returns `trigger`. PostgreSQL refuses to call a trigger
  function directly, so there is nothing to invoke. Touching its grants risks the
  signup path for no gain.
- `record_tombstone()` in `0003` is the same case: `security definer` so the
  marker is written by the trigger rather than by the caller, and `trigger`
  returning, so it cannot be invoked directly either. That is what lets the
  tombstones table have no insert policy at all.

`touch_updated_at()` was the one worth fixing — `0002` pins its `search_path`.

## Connecting the app

Set both variables wherever the app is built — Vercel → Settings → Environment
Variables, plus a local `.env` for development:

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Both come from **Project Settings → API**. Use the publishable key only.

With them set, every route sits behind a sign-in, the role comes from
`profiles.role`, and sync starts under that account. Without them the app runs
local-only, shows a Local mode banner, and the outbox is never written to.

## How sync works

IndexedDB is still the write path. An inspector in a crawlspace has to be able to
answer a question, take a photo and sign off with no signal at all, so nothing
ever waits on the network. A local write lands immediately and leaves a note in
an outbox; the engine in `src/lib/sync.ts` drains that outbox whenever there is a
connection and a signed-in account, then pulls back whatever changed elsewhere.

It runs on reconnect, when the tab becomes visible, every five minutes, and a
second or so after a change. Settings shows what is pending.

**Outbox entries are keyed `<entity>:<id>`**, so answering the same question
eight times collapses to one upload instead of eight.

**Pushes go in dependency order** — checklist, customer, inspection, photo —
because the foreign keys mean an inspection cannot arrive before the customer it
belongs to. An inspection whose checklist is not on the server uploads with a
null `template_id` rather than failing; the frozen snapshot still names the
checklist, and that is what reports read.

**Conflicts resolve last-write-wins.** Two people editing one record at the same
moment is not a real scenario here — one person walks one job. The exception is a
signed inspection, and that is handled by the server rather than by trust: the
`inspections_update_own_open` policy refuses any edit to a completed record
except by an admin, so a stale device cannot overwrite a signed report. A refused
change is kept and surfaced in Settings, not dropped silently.

**Deletes travel as tombstones.** A pull asks "what changed since I last
looked?", and a row that no longer exists cannot answer. Every delete leaves a
marker, written by trigger rather than by the client — so cascades are caught
too, and a device cannot forge one and make another device drop data.

**Photos are pulled as records, not bytes.** They are by far the heaviest thing
here, so the file is fetched the first time something renders it and cached
locally after that. Deleting a customer cascades the rows server-side but not the
files, so the bucket keys are collected before the local records go.

**The pull watermark is kept per table**, and only ever advances to a timestamp
the server itself returned. A single shared watermark taken from whichever table
answered first could skip past rows another was still writing, and a device whose
clock ran fast would skip rows it had never seen.

`npm run check:sync-mappers` round-trips every record through its database row
and back. A column renamed in a migration but not in `src/lib/syncMap.ts` is not
a type error — the field simply arrives back empty — and this is what catches it.

## Still to build

**Webhook events beyond `inspection.completed`.** The `events` column on an
endpoint is an array and the trigger filters on it, so `inspection.created` and
`task.flagged` are a trigger each rather than a schema change.

**Presence of other inspectors.** Nothing indicates that someone else is working
the same job right now; the first you know is when their inspection appears.
