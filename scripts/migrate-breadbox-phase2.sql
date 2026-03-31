-- Breadbox Club Phase 2 Migration
-- Run this in the Supabase SQL Editor after merging the Phase 2 PR.

-- 1. Add birthday column to profiles
alter table profiles add column if not exists birthday date;

-- 2. Add punch_count column to club_members
alter table club_members add column if not exists punch_count int not null default 0;

-- 3. Create referral_rewards table
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
create policy if not exists "Users read own referral rewards"
  on referral_rewards for select using (auth.uid() = member_id);

-- 4. Create referral_links table (click tracking)
create table if not exists referral_links (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references auth.users on delete cascade,
  code       text unique not null,
  clicks     int not null default 0,
  created_at timestamptz default now()
);
alter table referral_links enable row level security;
create policy if not exists "Users read own referral links"
  on referral_links for select using (auth.uid() = member_id);
create policy if not exists "Public increment referral clicks"
  on referral_links for update using (true);
