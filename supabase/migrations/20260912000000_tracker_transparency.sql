-- Tracker Transparency demo schema.
-- Run this migration with the Supabase CLI or paste it into the SQL editor.

create table if not exists public.tracker_events (
  id uuid primary key default gen_random_uuid(),
  page_url text not null,
  tracker_domain text not null,
  company_name text,
  category text,
  created_at timestamptz default now()
);

create table if not exists public.optout_log (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  method text not null,
  status text not null check (status in ('sent', 'committed', 'no_commitment')),
  created_at timestamptz default now()
);

alter table public.tracker_events enable row level security;
alter table public.optout_log enable row level security;

-- Deliberately permissive for the hackathon demo. Replace with authenticated
-- policies before using this outside a controlled demonstration.
create policy "anon can insert tracker events"
  on public.tracker_events for insert to anon with check (true);
create policy "anon can read tracker events"
  on public.tracker_events for select to anon using (true);
create policy "anon can insert opt-out logs"
  on public.optout_log for insert to anon with check (true);
create policy "anon can read opt-out logs"
  on public.optout_log for select to anon using (true);

create index if not exists tracker_events_created_at_idx
  on public.tracker_events (created_at desc);
create index if not exists tracker_events_page_url_created_at_idx
  on public.tracker_events (page_url, created_at desc);
create index if not exists optout_log_created_at_idx
  on public.optout_log (created_at desc);

-- Supabase Realtime reads from this publication. The guard makes the migration
-- safe to re-run when the table has already been enabled in the dashboard.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tracker_events'
  ) then
    alter publication supabase_realtime add table public.tracker_events;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'optout_log'
  ) then
    alter publication supabase_realtime add table public.optout_log;
  end if;
end;
$$;
