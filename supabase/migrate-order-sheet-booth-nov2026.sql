-- Order Sheet features in the admin (booth orders + Sold Today) — Nov 2026
-- Replaces Christina's separate Muse "Order Sheet" app: booth pre-orders live
-- in the same orders table as website orders (no sync), and walk-up sales get
-- their own table. Additive only — existing orders keep their values.
-- Safe to re-run.

-- ── 1. Orders: booth/website, paid flag, pickup date, phone, notes ──────────
alter table orders add column if not exists source      text    not null default 'website';
alter table orders add column if not exists paid        boolean not null default true;
alter table orders add column if not exists pickup_date date;
alter table orders add column if not exists phone       text;
alter table orders add column if not exists notes       text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_source_check') then
    alter table orders add constraint orders_source_check check (source in ('website', 'booth'));
  end if;
end $$;

-- Orders Christina already entered by hand in the admin were booth/phone orders
update orders set source = 'booth' where admin_created = true and source = 'website';

-- ── 2. Sold Today: one row per walk-up sale ─────────────────────────────────
create table if not exists booth_sales (
  id                uuid primary key default gen_random_uuid(),
  sale_date         date not null,
  stripe_product_id text,                       -- null for a custom item
  product_name      text not null,              -- "Product — Variety" snapshot
  quantity          int  not null default 1 check (quantity > 0),
  unit_amount       int  not null check (unit_amount >= 0),   -- cents, price of ONE
  created_by        uuid references auth.users on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists booth_sales_sale_date_idx on booth_sales (sale_date);
alter table booth_sales enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'booth_sales' and policyname = 'Admins manage booth sales') then
    create policy "Admins manage booth sales" on booth_sales
      for all
      using (exists (select 1 from admins where user_id = auth.uid()))
      with check (exists (select 1 from admins where user_id = auth.uid()));
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists booth_sales_updated_at on booth_sales;
create trigger booth_sales_updated_at
  before update on booth_sales
  for each row execute function public.set_updated_at();
