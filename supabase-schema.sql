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
  variation_name text not null default '',
  variation_delta integer not null default 0,
  created_at timestamptz default now(),
  unique(user_id, stripe_product_id, variation_name)
);

create table if not exists user_cart (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_product_id text not null,
  variation_name text not null default '',
  variation_delta integer not null default 0,
  quantity integer not null default 1,
  updated_at timestamptz default now(),
  unique(user_id, stripe_product_id, variation_name)
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

-- ─── Site Content ────────────────────────────────────────────────────────────
-- Generic key/value store for admin-editable site content (e.g. landing card images).
-- Requires a public Supabase Storage bucket named "site-images".
-- Create it in: Supabase dashboard → Storage → New bucket → Name: site-images → Public: ON

create table if not exists site_content (
  key   text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- ─── Product Details ─────────────────────────────────────────────────────────
-- Stores admin-managed descriptions and images for each Stripe product.
-- Requires a public Supabase Storage bucket named "product-images".
-- Create it in: Supabase dashboard → Storage → New bucket → Name: product-images → Public: ON

create table if not exists product_details (
  stripe_product_id text primary key,
  description text,
  ingredients text,
  image_url text,
  variations jsonb not null default '[]'::jsonb,
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
alter table site_content enable row level security;

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

-- Site content: public read, admin write
create policy "Public read site_content"
  on site_content for select using (true);

create policy "Admin write site_content"
  on site_content for all
  using (exists (select 1 from admins where user_id = auth.uid()));

-- Service role (webhook) can insert orders
create policy "Service insert orders"
  on orders for insert with check (true);

create policy "Service insert order items"
  on order_items for insert with check (true);

-- ─── Bread Box Club ───────────────────────────────────────────────────────────

-- Club memberships (one row per member, managed by webhook via service role)
create table if not exists club_members (
  user_id                uuid primary key references auth.users on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  status                 text not null default 'active', -- 'active' | 'cancelled' | 'past_due'
  started_at             timestamptz default now(),
  cancelled_at           timestamptz
);
alter table club_members enable row level security;
create policy "Users read own membership"
  on club_members for select using (auth.uid() = user_id);
-- Webhook (service role) manages all writes; no anon/user write policy needed.

-- Referral codes (one per user, auto-generated on first Club tab visit)
create table if not exists referral_codes (
  user_id    uuid primary key references auth.users on delete cascade,
  code       text unique not null,
  created_at timestamptz default now()
);
alter table referral_codes enable row level security;
create policy "Users manage own referral code"
  on referral_codes for all using (auth.uid() = user_id);
create policy "Public read referral codes"
  on referral_codes for select using (true);

-- Referral uses (one row per completed referral conversion)
create table if not exists referral_uses (
  id           uuid primary key default gen_random_uuid(),
  referrer_id  uuid references auth.users on delete set null,
  referred_id  uuid references auth.users on delete set null,
  code         text not null,
  type         text not null,    -- 'club' | 'regular'
  discount_pct int  not null,    -- 10 for club, 5 for regular
  used_at      timestamptz default now()
);
alter table referral_uses enable row level security;
create policy "Users read own referral uses"
  on referral_uses for select using (auth.uid() = referrer_id);
create policy "Service insert referral uses"
  on referral_uses for insert with check (true);

-- Box selections (saved box contents per club member)
create table if not exists box_selections (
  user_id    uuid primary key references auth.users on delete cascade,
  items      jsonb not null default '[]'::jsonb,
  -- items: [{ stripe_product_id, quantity, variation_name?, variation_delta? }]
  updated_at timestamptz default now()
);
alter table box_selections enable row level security;
create policy "Users manage own box"
  on box_selections for all using (auth.uid() = user_id);

-- Testimonials (customer reviews shown on home page)
create table if not exists testimonials (
  id           uuid primary key default gen_random_uuid(),
  quote        text not null,
  author_name  text not null,
  author_title text default '',
  image_url    text default '',
  rating       integer default 5 check (rating >= 1 and rating <= 5),
  sort_order   integer not null default 0,
  rating       integer default 5 check (rating >= 1 and rating <= 5),
  submitted_by uuid references auth.users on delete set null,
  status       text not null default 'approved' check (status in ('pending', 'approved', 'rejected')),
  visible      boolean not null default true,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);
alter table testimonials enable row level security;
create policy "Public read visible testimonials"
  on testimonials for select using (visible = true);
create policy "Users read own testimonials"
  on testimonials for select using (auth.uid() = submitted_by);
create policy "Users submit testimonials"
  on testimonials for insert with check (
    auth.uid() is not null
    and auth.uid() = submitted_by
    and status = 'pending'
    and visible = false
  );
create policy "Admins manage testimonials"
  on testimonials for all using (
    exists (select 1 from admins where user_id = auth.uid())
  );
