-- Bloomin' Acres — Full Schema
-- Run this in the Supabase dashboard SQL editor

-- ─── Menu ────────────────────────────────────────────────────────────────────

create table if not exists menu_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references menu_sections(id) on delete cascade,
  stripe_product_id text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- ─── Admins ──────────────────────────────────────────────────────────────────
-- Admin users are created manually in the Supabase dashboard.
-- After creating an admin user, insert their UUID here:
--   insert into admins (user_id) values ('<uuid>');

create table if not exists admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

-- ─── User Data ───────────────────────────────────────────────────────────────

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  updated_at timestamptz default now()
);

create table if not exists user_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_product_id text not null,
  created_at timestamptz default now(),
  unique(user_id, stripe_product_id)
);

create table if not exists user_cart (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_product_id text not null,
  quantity integer not null default 1,
  updated_at timestamptz default now(),
  unique(user_id, stripe_product_id)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_session_id text unique,
  status text not null default 'pending',
  total_amount integer,
  created_at timestamptz default now()
);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  stripe_product_id text not null,
  product_name text,
  quantity integer not null default 1,
  unit_amount integer
);

-- ─── Menu Schedule ───────────────────────────────────────────────────────────
-- Singleton row (id=1) storing the active date range shown on the menu page.

create table if not exists menu_schedule (
  id integer primary key default 1,
  start_date date,
  end_date date,
  updated_at timestamptz default now()
);

-- ─── Saved Menus ─────────────────────────────────────────────────────────────
-- Named snapshots of menu_sections + menu_items the admin can reload later.

create table if not exists saved_menus (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sections jsonb not null,
  created_at timestamptz default now()
);

-- ─── Product Details ─────────────────────────────────────────────────────────
-- Stores admin-managed descriptions and images for each Stripe product.
-- Requires a public Supabase Storage bucket named "product-images".
-- Create it in: Supabase dashboard → Storage → New bucket → Name: product-images → Public: ON

create table if not exists product_details (
  stripe_product_id text primary key,
  description text,
  image_url text,
  updated_at timestamptz default now()
);

-- ─── Row Level Security ──────────────────────────────────────────────────────

alter table menu_sections enable row level security;
alter table menu_items enable row level security;
alter table admins enable row level security;
alter table profiles enable row level security;
alter table user_favorites enable row level security;
alter table user_cart enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table product_details enable row level security;
alter table menu_schedule enable row level security;
alter table saved_menus enable row level security;

-- Public: anyone can read the menu
create policy "Public read sections"
  on menu_sections for select using (true);

create policy "Public read items"
  on menu_items for select using (true);

-- Admin only: write to menu (drop old permissive policies first if they exist)
-- drop policy if exists "Auth write sections" on menu_sections;
-- drop policy if exists "Auth write items" on menu_items;

create policy "Admin write sections"
  on menu_sections for all
  using (exists (select 1 from admins where user_id = auth.uid()));

create policy "Admin write items"
  on menu_items for all
  using (exists (select 1 from admins where user_id = auth.uid()));

-- Admins table: each admin can read their own row
create policy "Admins read own row"
  on admins for select using (auth.uid() = user_id);

-- Users: can only access their own data
create policy "Users manage own profile"
  on profiles for all using (auth.uid() = user_id);

create policy "Users manage own favorites"
  on user_favorites for all using (auth.uid() = user_id);

create policy "Users manage own cart"
  on user_cart for all using (auth.uid() = user_id);

create policy "Users read own orders"
  on orders for select using (auth.uid() = user_id);

create policy "Users read own order items"
  on order_items for select
  using (exists (select 1 from orders where id = order_id and user_id = auth.uid()));

-- Product details: public read, admin write
create policy "Public read product_details"
  on product_details for select using (true);

create policy "Admin write product_details"
  on product_details for all
  using (exists (select 1 from admins where user_id = auth.uid()));

-- Menu schedule: public read, admin write
create policy "Public read menu_schedule"
  on menu_schedule for select using (true);

create policy "Admin write menu_schedule"
  on menu_schedule for all
  using (exists (select 1 from admins where user_id = auth.uid()));

-- Saved menus: admin only
create policy "Admin manage saved_menus"
  on saved_menus for all
  using (exists (select 1 from admins where user_id = auth.uid()));

-- Service role (webhook) can insert orders
create policy "Service insert orders"
  on orders for insert with check (true);

create policy "Service insert order items"
  on order_items for insert with check (true);
