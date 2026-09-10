# LJA Lion Cafe Lunch Ordering — Full Setup Guide

This project is a ready-to-deploy Netlify site:

- `index.html` — the parent-facing lunch order form
- `staff/orders.html` — a passcode-protected staff page to view and
  export orders
- `thank-you.html` — page parents land on after paying
- `netlify/functions/create-checkout.mjs` — validates the order and creates
  a Square Payment Link
- `netlify/functions/square-webhook.mjs` — Square calls this automatically
  once a payment completes; it marks the order "paid"
- `netlify/functions/get-orders.mjs` — the staff page's data source
- `netlify/functions/check-orders.mjs` — lets a parent look up "did I
  already order?" by phone number, no login needed (see note below)
- `netlify/functions/_shared/` — the menu/calendar rules shared by the
  functions above

Orders are stored in **Netlify Blobs** (built-in, no extra account
needed). The staff page reads live from there and has an **Export CSV**
button for a backup copy any time you want one — no Google account or
external spreadsheet needed.

### A privacy note on the phone lookup feature

Parents now enter a phone number alongside name and email, and there's
a "Did I already order?" box near the top of the form where they can
type that number back in to see any upcoming orders tied to it — no
password. This is deliberately low-friction for parents who may not
reliably check email, but the tradeoff is real: anyone who knows (or
guesses) a phone number can see that family's child names, days, and
what they ordered. It does **not** expose payment info, email
addresses, or historical (past) orders — only today-forward. If this
tradeoff doesn't sit right for your school, a reasonable next step
would be adding a second identifier (like the child's name) that must
also match before results show — ask if you'd like that added.

## 1. Get your Square credentials

1. Go to https://developer.squareup.com and log in (or create an account).
2. Create an **Application** (e.g. "LJA Lunch Orders").
3. Under that application, for **Sandbox** first, get:
   - **Sandbox Access Token**
   - **Sandbox Location ID** (under Locations)
4. Once everything works in Sandbox (Step 5 below), switch to the
   **Production** tab of the same application for your real credentials.

## 2. Deploy this folder to Netlify

**Drag and drop (fastest):**
1. https://app.netlify.com → **Add new site** → **Deploy manually**.
2. Drag this whole folder onto the upload area. Netlify reads
   `netlify.toml` and `package.json` and sets everything up, including
   installing `@netlify/blobs` for the functions.

**Or connect to Git** (better for ongoing edits): push this folder to a
GitHub repo, then **Add new site → Import an existing project** in
Netlify. Leave build settings blank — there's nothing to build.

## 3. Set environment variables

Netlify dashboard → this site → **Site configuration → Environment
variables**. Add all of these:

| Key | Value |
|---|---|
| `SQUARE_ACCESS_TOKEN` | Sandbox token now, Production token later |
| `SQUARE_LOCATION_ID` | Sandbox location ID now, Production later |
| `SQUARE_ENV` | `sandbox` while testing, `production` when live |
| `SQUARE_REDIRECT_URL` | `https://YOUR-SITE.netlify.app/thank-you.html` |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | from Step 4 below |
| `SQUARE_WEBHOOK_NOTIFICATION_URL` | `https://YOUR-SITE.netlify.app/.netlify/functions/square-webhook` |
| `STAFF_ORDERS_PASSCODE` | any passcode you make up for staff |
| `NETLIFY_SITE_ID` | see below |
| `NETLIFY_BLOBS_TOKEN` | see below |

**Where to find `NETLIFY_SITE_ID`:** this site's dashboard →
**Site configuration → General → Site details** — it's labeled "Site
ID" (a long string like `a1b2c3d4-...`).

**Where to get `NETLIFY_BLOBS_TOKEN`:** click your account avatar (top
right of any Netlify page) → **User settings → Applications → Personal
access tokens → New access token**. Give it any description, create it,
and copy the token immediately (Netlify only shows it once). This is
what lets the order-storage system (Netlify Blobs) authenticate — it's
needed because this deployment doesn't auto-configure that on its own.

Redeploy (**Deploys → Trigger deploy**) after adding/changing variables.

## 4. Set up the Square webhook (this is what makes order-logging work)

Square needs to tell your site when a payment completes.

1. In the Square Developer Dashboard, open your application →
   **Webhooks**.
2. Add a new subscription. **Notification URL** must be exactly:
   `https://YOUR-SITE.netlify.app/.netlify/functions/square-webhook`
   (must match `SQUARE_WEBHOOK_NOTIFICATION_URL` above exactly, including
   `https://` and no trailing slash).
3. Subscribe to the event: **`payment.updated`** (and `payment.created`
   if offered).
4. Save. Square will show you a **Signature Key** for this
   subscription — copy that into `SQUARE_WEBHOOK_SIGNATURE_KEY`.
5. Do this once for Sandbox and once more for Production when you switch
   over (each has its own webhook subscription and signature key).

Square's exact webhook UI and signature-verification details can shift
over time — if signature verification fails, double check the current
steps at developer.squareup.com/docs/webhooks against what's in
`square-webhook.mjs`.

## 5. Test end to end (Sandbox)

1. Open your site, add a child + grade, check a lunch day, fill in
   parent name + email, pay with a Sandbox test card
   (`4111 1111 1111 1111`, any future expiry, any CVV).
2. You should land on `thank-you.html`.
3. Check **Netlify → Functions → square-webhook → logs** to confirm the
   webhook fired and processed successfully.
4. Open `https://YOUR-SITE.netlify.app/staff/orders.html`, enter your
   `STAFF_ORDERS_PASSCODE`, and confirm the order shows up with status
   "paid" and the correct child/day/item.
5. Click **Export CSV** and confirm the file downloads with that order
   in it — that's your backup copy, no extra setup needed for it.

Once all of that works, flip `SQUARE_ENV` to `production`, swap in your
Production Square credentials and a Production webhook subscription
(Step 4 again), redeploy, and you're taking live payments with working
order logs.

## 6. Using the staff orders page day-to-day

Go to `https://YOUR-SITE.netlify.app/staff/orders.html`, enter the
passcode once (it stays remembered for that browser tab's session).
You'll see:
- **Kitchen prep summary** — how many of each item are needed, for
  whichever day you've selected (defaults to today).
- **Order detail** — every child, grade, day, item, and parent, with
  payment status, so you can also spot any orders that started checkout
  but never completed payment ("pending").
- **Export CSV** — downloads whatever's currently shown (the selected
  day, or "All upcoming") as a spreadsheet-ready file — open it in
  Excel, Google Sheets, Numbers, whatever you use. Use this any time you
  want a backup copy or need to hand data to someone else.

Share this URL + passcode only with staff who need it — anyone with both
can view and export (but not modify or refund) order data.

## 7. Keeping the menu/calendar rules in sync

The menu, prices, the 5:00 PM deadline rule, school-year bounds, and the
holiday calendar exist in **two places**:
- `index.html` — what parents see and can select (for a fast, responsive
  form)
- `netlify/functions/_shared/schoolCalendar.mjs` — what the server
  actually enforces before any money moves

If you change the menu, prices, the deadline, or the calendar, **update
both**. This duplication is intentional — the server never trusts what
the browser sends, so a parent can't get a valid checkout by tampering
with the page.

### How the ordering week works (fully automatic)

- **A new week opens every Saturday at 10:00 PM**, showing the following
  Monday–Friday. Before that moment, the previous week still shows.
- The season is bounded to **Mon, Aug 17, 2026 – Tue, Jun 2, 2027** — the
  form shows nothing outside that range.
- Days on a school holiday/break are skipped automatically (see
  `OFF_DATES` in both files). Early-dismissal and note days (Erev Rosh
  Hashana, Tzom Gedaliah, Ta'anit Esther, President's Day, Yom
  Hashoah/Hazikaron/Ha'atzmaut, Lag B'Omer) are treated as **normal
  school days** and are not skipped, per instructions.

A few calendar entries were genuinely ambiguous from the source PDF and
are worth double-checking against actual school practice:
- **Aug 5 & Aug 13, 2026** — marked off (Staff Reports / Orientation,
  not regular instructional days) — confirm no lunch service expected.
- **President's Day (Feb 15, 2027)** — left as a normal school day since
  it wasn't marked "No School" on the calendar; many schools do close.
- **Chanukah Break (Dec 7, 2026)** — only that single day is marked off;
  confirm if the real break spans more days.

To change any of this: edit `addOffRange(...)` calls and
`SCHOOL_YEAR_START` / `SCHOOL_YEAR_END` in **both**
`netlify/functions/_shared/schoolCalendar.mjs` and the `<script>` in
`index.html`, then redeploy.

## 8. K-5 teacher daily lunch email — setup

Every school day at 8:10 AM Eastern, each K-5 teacher automatically
receives an email listing which of their students ordered lunch that
day. Teachers who teach more than one grade (currently just Abigail
Treasure, 3rd & 5th) get both grades listed in one email.

### One-time setup

1. **Create a free account at [resend.com](https://resend.com)** — this
   is the email-sending service; nothing in Netlify or Square sends
   email on its own.
2. **Verify your domain** (`ljaonline.com`) inside Resend, following
   their domain-verification steps (adding a few DNS records — your
   web/IT provider or whoever manages ljaonline.com's DNS can help if
   needed). Emails can't actually send until this is done — Resend
   won't let you send from an address on an unverified domain.
3. Create an **API key** in Resend, and add these two environment
   variables in Netlify:

   | Key | Value |
   |---|---|
   | `RESEND_API_KEY` | the API key from Resend |
   | `TEACHER_EMAIL_FROM` | an address on your verified domain, e.g. `lunch@ljaonline.com` |

4. Redeploy so the new environment variables and the new scheduled
   function take effect.

### To update the teacher roster

Edit `netlify/functions/_shared/teacherRoster.mjs` — add, remove, or
change a teacher's grade(s) there. Grade labels must be one of `PK2`,
`PK3`, `PK4`, `K`, `1st`, `2nd`, `3rd`, `4th`, or `5th` (matching
`GRADE_LABEL_TO_FULL` in that same file). Redeploy after editing.

**Note:** PK2/PK3/PK4 are now valid grade options on the parent order
form, but no PK teachers are in this roster yet — add them the same way
as any other teacher (e.g. `{ name: "...", email: "...", grades: ["PK3"] }`)
whenever you're ready for them to start receiving the daily email.

### How the scheduling actually works

Cron schedules run in UTC, but "8:10 AM" in Florida shifts by an hour
between winter (EST) and summer (EDT) as Daylight Saving Time changes.
Rather than a single fixed time that would drift an hour off twice a
year, this function is scheduled to run every 10 minutes across a
window covering both possibilities (`config.schedule` in
`teacher-daily-email.mjs`), and the function itself checks the real
Eastern-time clock, only actually sending once it's genuinely 8:10 AM
locally. A log entry in Netlify Blobs (`teacher-email-log` store)
guarantees it only sends once per day even though the schedule fires
several times during that hour.

It also automatically skips weekends, holidays, and any day outside the
school year, using the same calendar as the ordering form (Section 7)
— nothing extra to maintain there.

### A note on what I couldn't verify

Netlify's scheduled-functions feature and exact syntax may have shifted
since this was written — if the function doesn't appear to be running
on schedule at all, check Netlify's current docs on Scheduled Functions
against what's in `teacher-daily-email.mjs`, and check **Functions →
teacher-daily-email → logs** in the Netlify dashboard to see if it's
firing and what it's returning. I also couldn't test an actual email
send from this environment (no way to reach Resend's API from here) —
the code is correct as written, but a real end-to-end test (does the
email actually land, does it look right in an inbox) is worth doing
once it's deployed.

## 9. Admin daily summary PDF — setup

Each school morning at 8:10 AM Eastern (same time as the teacher
email), a PDF version of the daily summary — the same content as the
"Print Daily Summary" button on the staff page — is emailed to the
administrator list.

This PDF is built entirely on the server using a lightweight library
called `pdf-lib`, deliberately chosen over a headless-browser approach
(like Puppeteer) since that would have added a much heavier, more
fragile dependency to a project that already had one bad experience
with a broken dependency chain (`@netlify/otel`). `pdf-lib` has a small,
clean dependency tree and draws the PDF directly rather than rendering
HTML, so it's both lighter and more reliable in a serverless
environment.

### Setup

This reuses the exact same `RESEND_API_KEY` and `TEACHER_EMAIL_FROM`
environment variables already set up for the teacher email (Section 8)
— no new environment variables needed.

### To update the admin recipient list

Edit `netlify/functions/_shared/adminRecipients.mjs` — it's just a
plain list of email addresses. Add, remove, or fix a typo there, then
redeploy.

**Current list has two different domains** (`ljaonline.com` and
`tjaonline.com`) — this matches exactly what was provided when this was
set up. Worth double-checking this is intentional and not a typo (we've
had a mixed-domain typo cause a real problem once already in this
project, with `TEACHER_EMAIL_FROM`).

### What's in the PDF

- Top stats: paid orders, revenue, how many grades ordered, and a
  flagged count of unpaid/incomplete checkouts if any
- Totals by grade band (K–5, 6–8, 9–12)
- Kitchen prep item counts
- Totals by grade
- Full student list per grade (child + parent name)
- A separate flagged section for anyone who started checkout but never
  finished paying

### Testing note

I generated real sample PDFs using this exact code (not a mockup) and
visually confirmed the layout, verified all the numbers add up
correctly, and confirmed it correctly spans multiple pages for larger
order volumes (tested with 90 students across 6 grades → 3 pages). What
I could not test from this environment: an actual Resend delivery with
a real PDF attachment landing in a real inbox — that first live send is
worth watching closely in the Netlify function logs (**Functions →
admin-daily-summary → logs**) the first morning it runs for real.

## 10. Automatic order archiving (performance)

The "orders" store never removed anything on its own — every order ever
placed just kept piling up, and functions like the phone lookup had to
scan the *entire* history every time. As the school year went on, this
started timing out for real parents.

**The fix:** `archive-old-orders.mjs` runs once a day (around 4-5 AM
Eastern) and moves any order whose items are ALL more than 2 weeks in
the past into a separate `archived-orders` store, removing it from the
live `orders` store. An order is only archived if *every* item on it is
old — if it has even one recent item, the whole order stays live. This
keeps the live store roughly bounded to the last few weeks of activity
instead of growing all year, which speeds up every function that reads
from it: `get-orders`, `check-orders`, the teacher email, and the admin
summary — none of them needed any code changes for this, since they
just naturally scan less data now.

Nothing is ever deleted by this — archived orders are still fully
viewable on the staff page's **Archived orders** tab. This is different
from the **Deleted orders** tab: archived orders are ordinary completed
orders that just aged out; deleted orders were manually removed because
something was cancelled/refunded.

**To change the 2-week cutoff:** edit `ARCHIVE_AFTER_DAYS` in
`archive-old-orders.mjs`.

## 11. "Did I already order?" now only searches the current week

`check-orders.mjs` used to scan every stored order for a phone number
match, checking only whether each item's date was "today or later" —
meaning it searched arbitrarily far into the future and (before
archiving existed) arbitrarily far into the past too, contributing to
the same slowdown described above.

It now uses `getCurrentOrderingWeekBounds()` (in
`_shared/schoolCalendar.mjs`) to compute the exact same Monday-Friday
window the parent form itself is currently showing, and only searches
within that. The lookup box on the form says so explicitly now too
("We'll check orders placed for the current ordering week only..."),
so parents aren't left wondering why an order from a different week
didn't show up.

## 12. A real timezone display bug, found and fixed

While building the above, testing surfaced a genuine bug: the "Ordering
week: ..." banner and each day's date label could display **one day
off** for any visitor whose device timezone wasn't set to Eastern —
even though the actual deadline enforcement (the part that really
matters for whether an order goes through) was already correct.

The cause: `dateFmt` was forced to always format in `America/New_York`
after an earlier fix (for the deadline time, where that's genuinely
necessary). But it was also being reused for values like `WINDOW_START`,
`WINDOW_END`, and each day's date — which are *calendar-date-only*
containers built from the visitor's own local time, already correctly
anchored to the right Eastern calendar day. Formatting those through an
explicitly different timezone could shift them backward by a day.

**The fix:** there are now two formatters, used for two different kinds
of values:
- `dateFmt` / `timeFmt` — forced to `America/New_York`, used **only**
  for the deadline (a genuine UTC instant, where the visitor's own
  timezone must be ignored).
- `calendarDateFmt` — no forced timezone, used for calendar-only values
  (`WINDOW_START`, `WINDOW_END`, each day's date) that are already
  correct as built.

Verified directly by simulating both a UTC-timezone device and a real
Eastern-timezone device against the exact same moment in time, and
confirming both now show the identical, correct dates.
