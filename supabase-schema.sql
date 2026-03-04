-- Bloomin' Acres — Menu Schema
-- Run this in the Supabase dashboard SQL editor

-- Sections (e.g., "Sourdough Loaves", "Pastries")
create table if not exists menu_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- Items linked to sections, referencing Stripe product IDs
create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references menu_sections(id) on delete cascade,
  stripe_product_id text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- Row Level Security
alter table menu_sections enable row level security;
alter table menu_items enable row level security;

-- Public: anyone can read the menu
create policy "Public read sections"
  on menu_sections for select using (true);

create policy "Public read items"
  on menu_items for select using (true);

-- Authenticated: logged-in admin can write
create policy "Auth write sections"
  on menu_sections for all using (auth.role() = 'authenticated');

create policy "Auth write items"
  on menu_items for all using (auth.role() = 'authenticated');
