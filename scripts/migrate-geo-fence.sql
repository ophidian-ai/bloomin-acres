-- Geo-fence Delivery Migration
-- Run this in the Supabase SQL Editor after merging the geo-fence PR.

-- 1. Add address + delivery columns to profiles
alter table profiles add column if not exists address text;
alter table profiles add column if not exists city text;
alter table profiles add column if not exists state text;
alter table profiles add column if not exists zip text;
alter table profiles add column if not exists delivery_lat double precision;
alter table profiles add column if not exists delivery_lng double precision;
alter table profiles add column if not exists delivery_eligible boolean;

-- 2. Seed geo-fence configuration (admin-editable via site_content)
-- Bakery origin: 3650 N State Rd. 9, Hope, IN 47246
-- Default radius: 15 miles
insert into site_content (key, value) values
  ('geo-fence-origin-lat', '39.3072'),
  ('geo-fence-origin-lng', '-85.7697'),
  ('geo-fence-radius-miles', '15')
on conflict (key) do nothing;
