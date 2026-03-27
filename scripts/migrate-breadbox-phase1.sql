-- Breadbox Club Phase 1 Migration
-- Run this in the Supabase SQL Editor after merging the Phase 1 PR.

-- 1. Add pending_referral_code column to club_members
alter table club_members add column if not exists pending_referral_code text;

-- 2. Insert new referral milestone reward text into site_content
-- These are the defaults shown on the club page; admin can override via dashboard.
insert into site_content (key, value) values
  ('referral-reward-1', '2% bonus discount — stacked on your 5% for 30 days'),
  ('referral-reward-3', 'Free item credit — added to your account, no expiry'),
  ('referral-reward-5', '10% off one order — promo code emailed, valid 90 days')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- 3. Clean up old milestone reward text (no longer used)
delete from site_content where key in ('referral-reward-15', 'referral-reward-25');
-- Note: 'referral-reward-5' is reused (5 referrals in new system) so we update it above.
