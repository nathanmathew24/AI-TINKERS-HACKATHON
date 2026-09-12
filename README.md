# Expose backend + dashboard

This repository provides the Supabase side of the Expose demo, plus the
browser extension under `extension/`.

## Deploy the database and function

1. Create a Supabase project and link the Supabase CLI to it.
2. Apply `supabase/migrations/20260912000000_tracker_transparency.sql` in the SQL Editor or run `supabase db push`.
3. Store the LLM credential server-side: `supabase secrets set OPENROUTER_API_KEY=...`.
4. Deploy the function: `supabase functions deploy risk-summary`.

The migration creates `tracker_events` and `optout_log` with the exact column names expected by the extension, enables RLS, grants `anon` read/insert access for this demo, and adds both tables to the Realtime publication.

## Run the dashboard

1. Copy `dashboard/config.example.js` to `dashboard/config.js`.
2. Add only the Supabase Project URL and anon/public key. Do **not** add a service-role key.
3. From `dashboard`, start a local web server, for example `npx serve .`, then open the displayed address.

The dashboard labels each GPC log as either “committed to honoring this” or “no known commitment.” It does not claim that an opt-out was confirmed. The curated list is in `dashboard/gpc_commitments.json`; recheck it before a public presentation.
