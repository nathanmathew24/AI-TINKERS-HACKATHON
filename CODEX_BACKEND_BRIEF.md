# Tracker Transparency — Backend + Dashboard Build Brief

## What we're building (context for you, Codex)

A Chrome extension watches which third-party companies (ad networks, analytics,
data brokers) a webpage secretly contacts while someone browses it, shows the
user a live, plain-English readout of who's tracking them, and lets them send a
real opt-out signal (Global Privacy Control / GPC) with honest logging of what
was actually sent.

**Your scope is everything EXCEPT the browser extension itself.** A teammate is
building the Chrome extension in parallel, on a separate branch. The extension
will insert rows directly into your Supabase tables using the anon key — you do
not need to build anything that talks back to the extension. Your job is: the
database, one Edge Function, and a live dashboard.

Do not touch anything under `/extension`. Work only in `/backend` and
`/dashboard`.

---

## The contract (do not change without telling the extension side)

The extension inserts rows shaped exactly like this. Build your schema to match:

```sql
create table tracker_events (
  id uuid primary key default gen_random_uuid(),
  page_url text not null,
  tracker_domain text not null,
  company_name text,
  category text,
  created_at timestamptz default now()
);

create table optout_log (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  method text not null,        -- e.g. "GPC"
  status text not null,        -- "sent" | "committed" | "no_commitment"
  created_at timestamptz default now()
);
```

Enable row-level security but add a permissive INSERT and SELECT policy for the
`anon` role on both tables — this is a hackathon demo, not production, so don't
spend time on tight auth.

---

## Task 1 — Supabase project setup

1. Create the two tables above via SQL editor or migration.
2. Enable **Realtime** on `tracker_events` (Database → Replication → toggle it
   on) — the dashboard needs to subscribe to live inserts.
3. Confirm you can insert a manual test row via the Supabase table UI and see
   it appear.
4. Note down: project URL, anon key, service role key (service key stays
   server-side only, never in the dashboard).

---

## Task 2 — Edge Function: Risk Synthesis Agent

Create a Supabase Edge Function (Deno) called `risk-summary`.

**Input (POST body):**
```json
{
  "page_url": "https://example.com/article",
  "trackers": [
    { "company_name": "Google Ads", "category": "advertising" },
    { "company_name": "Acme Analytics", "category": "analytics" },
    { "company_name": "DataBrokerX", "category": "data_broker" }
  ]
}
```

**Output:**
```json
{
  "summary": "This page contacted 3 companies, including 1 data broker.",
  "risk_level": "medium"
}
```

**Use OpenRouter for the LLM call, not OpenAI directly** — we have OpenRouter
sponsor credits for this hackathon. Call:

```
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json

{
  "model": "<pick a fast/cheap model — this only needs to summarize a short list, not reason deeply>",
  "messages": [
    { "role": "system", "content": "You are a plain-English privacy summarizer. Given a list of companies that tracked a user on a webpage, write ONE short sentence a non-technical person would understand, then classify risk as low, medium, or high based on how many data brokers/trackers are present. Respond as JSON: {\"summary\": string, \"risk_level\": \"low\"|\"medium\"|\"high\"}." },
    { "role": "user", "content": "<the trackers list as JSON>" }
  ]
}
```

Store `OPENROUTER_API_KEY` as a Supabase Edge Function secret
(`supabase secrets set OPENROUTER_API_KEY=...`), never hardcode it.

Keep latency low — this gets called live during the demo every time the
tracker list on a page changes, so pick a fast model and keep the prompt short.

---

## Task 3 — GPC commitment list

Hardcode a small JSON file (`gpc_commitments.json`) — no API exists for this,
so just curate ~10-15 well-known companies that have publicly committed to
honoring Global Privacy Control (e.g. via globalprivacycontrol.org's public
list) vs. ones with no known commitment. This is used to label opt-out log
entries honestly: "sent — committed" vs. "sent — no known commitment."

---

## Task 4 — Opt-out logging

When the extension sends a GPC signal (it does this on its own side, you don't
trigger it), it will insert a row into `optout_log` with `status: "sent"`.
Write a small piece of logic (can be a DB trigger, or handled client-side in
the dashboard, whichever is faster for you) that looks up `company_name`
against `gpc_commitments.json` and updates/displays whether that company is
"committed" or "no_commitment". Do not claim "confirmed" or "opted out" — only
ever "sent" + commitment status. This honesty framing matters for the pitch.

---

## Task 5 — Live dashboard (`/dashboard/index.html`)

**Important: this must be a plain static HTML file you run locally (e.g. via
`npx serve` or just opening the file), NOT deployed inside any sandboxed
artifact tool** — Supabase Realtime needs an open websocket connection that
sandboxed preview tools block.

Build a single-page dashboard that:

1. Loads the Supabase JS client from a CDN:
   `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`
2. Subscribes to `tracker_events` via Realtime, and as new rows come in,
   appends them to a live-growing list showing: company name, category,
   timestamp — this should visibly grow while someone is browsing on the
   other screen during the demo.
3. Shows the current risk summary (call the `risk-summary` Edge Function
   whenever the tracker list for the current `page_url` changes, display the
   returned `summary` sentence and a colored badge for `risk_level`).
4. Shows the `optout_log` as a running list with each entry's honest status
   ("Sent to Google Ads — committed to honoring this" / "Sent to X — no known
   commitment").
5. Keep styling minimal — this needs to be readable from a few feet away on a
   projector, not polished. Big text, clear list, no clutter.

---

## Priority order if you run low on time

1. Supabase tables + Realtime working (non-negotiable — everything depends on it)
2. Dashboard showing live tracker events (this is the single most important demo visual)
3. Risk Synthesis Edge Function + summary display
4. Opt-out log + GPC commitment labeling (cut this last if time runs out — it's
   the smallest, most skippable piece)

## Environment variables you'll need

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENROUTER_API_KEY=
```
