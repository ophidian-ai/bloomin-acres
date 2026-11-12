-- Bread Box Club fix (site change #5) — Nov 2026
-- Run once in the Supabase SQL editor. Safe to re-run: every statement is idempotent.
--
-- Why: scripts/migrate-breadbox-phase2.sql used `create policy if not exists`,
-- which Postgres does not support, so that script can fail part-way. This
-- re-asserts everything the Club code depends on.

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table profiles     add column if not exists birthday date;
alter table club_members add column if not exists punch_count int not null default 0;
alter table club_members add column if not exists pending_referral_code text;

-- ── Box selections (My Box picker) ───────────────────────────────────────────
create table if not exists box_selections (
  user_id    uuid primary key references auth.users on delete cascade,
  items      jsonb not null default '[]'::jsonb,
  updated_at timestamptz default now()
);
alter table box_selections enable row level security;

-- ── Referral rewards / links ────────────────────────────────────────────────
create table if not exists referral_rewards (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references auth.users on delete cascade,
  milestone    int not null,
  reward_type  text not null,
  reward_value text,
  expires_at   timestamptz,
  claimed_at   timestamptz,
  created_at   timestamptz default now()
);
alter table referral_rewards enable row level security;

-- ── Policies (created only when missing) ────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'box_selections' and policyname = 'Users manage own box') then
    create policy "Users manage own box" on box_selections
      for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'referral_rewards' and policyname = 'Users read own referral rewards') then
    create policy "Users read own referral rewards" on referral_rewards
      for select using (auth.uid() = member_id);
  end if;

  -- Admins can read memberships and referral activity from the dashboard
  if not exists (select 1 from pg_policies where tablename = 'club_members' and policyname = 'Admins read memberships') then
    create policy "Admins read memberships" on club_members
      for select using (exists (select 1 from admins where user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'referral_uses' and policyname = 'Admins read referral uses') then
    create policy "Admins read referral uses" on referral_uses
      for select using (exists (select 1 from admins where user_id = auth.uid()));
  end if;
  -- (profiles already has "Admins read all profiles" in the live database)
end $$;

-- ── Admin photo uploads (Landing Page + product photos) ─────────────────────
-- The site-images bucket was created by hand with no upload policy, so
-- Admin → Landing Page uploads were rejected by storage RLS. Admins may now
-- add and replace files; everyone else still only reads the public URLs.
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Admins add site photos') then
    create policy "Admins add site photos" on storage.objects
      for insert to authenticated
      with check (bucket_id in ('site-images', 'product-images')
                  and exists (select 1 from public.admins where user_id = auth.uid()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Admins replace site photos') then
    create policy "Admins replace site photos" on storage.objects
      for update to authenticated
      using (bucket_id in ('site-images', 'product-images')
             and exists (select 1 from public.admins where user_id = auth.uid()))
      with check (bucket_id in ('site-images', 'product-images')
                  and exists (select 1 from public.admins where user_id = auth.uid()));
  end if;

  -- Replacing a file (upsert) needs to see the existing one first
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Admins list site photos') then
    create policy "Admins list site photos" on storage.objects
      for select to authenticated
      using (bucket_id in ('site-images', 'product-images')
             and exists (select 1 from public.admins where user_id = auth.uid()));
  end if;
end $$;

-- ── Referral reward text (1 / 3 / 5 ladder) ─────────────────────────────────
-- Only seeds rows that don't exist yet; Christina's saved wording is never overwritten.
insert into site_content (key, value) values
  ('referral-reward-1', '2% bonus discount — stacked on your 5% for 30 days'),
  ('referral-reward-3', 'Free item credit — added to your account, no expiry'),
  ('referral-reward-5', '10% off one order — promo code emailed, valid 90 days')
on conflict (key) do nothing;
