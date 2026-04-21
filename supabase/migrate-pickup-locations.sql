-- Pickup Locations — Admin-configured locations customers can select as their preferred pickup spot

create table if not exists pickup_locations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  address          text not null,
  hours            text,
  notes            text,
  calendar_event_id text,
  sort_order       integer not null default 0,
  active           boolean not null default true,
  created_at       timestamptz default now()
);

alter table pickup_locations enable row level security;

-- Active locations are publicly readable (so the account page can load them without auth)
create policy "Public read active pickup_locations"
  on pickup_locations for select using (active = true);

-- Admins can read all locations (including inactive) and manage them
create policy "Admin manage pickup_locations"
  on pickup_locations for all
  using (exists (select 1 from admins where user_id = auth.uid()));

-- ─── Profile: preferred pickup location ──────────────────────────────────────
-- Add preferred_pickup_location_id to profiles (nullable FK, cleared if location is deleted)

alter table profiles
  add column if not exists preferred_pickup_location_id uuid references pickup_locations(id) on delete set null;

-- ─── Orders: pickup location snapshot ────────────────────────────────────────
-- Store the location name as a text snapshot so historical orders are unaffected
-- if the location is later renamed or deleted.

alter table orders
  add column if not exists pickup_location_name text;
