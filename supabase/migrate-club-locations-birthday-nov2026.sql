-- Club-only delivery locations + birthday lock — Nov 2026
-- Run in the Supabase SQL editor (or `supabase db query --linked -f`).
-- Sections 1–2 are safe to re-run. Section 3 is a one-time setup.

-- ── 1. Club-only locations ──────────────────────────────────────────────────
-- Locations ticked "Club members only" in Admin → Locations are the Bread Box
-- Club delivery perk: non-members see them greyed out and checkout refuses them.
alter table pickup_locations add column if not exists club_only boolean not null default false;

-- ── 2. Birthday can only be set once by the customer ────────────────────────
-- Stops members changing their birthday to claim the treat again. Admins
-- (Admin → Customers) and the server (service role) can still correct it.
create or replace function public.lock_profile_birthday()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.birthday is not null
     and new.birthday is distinct from old.birthday
     and coalesce(auth.role(), '') <> 'service_role'
     and not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'Your birthday is already saved. Please contact Bloomin'' Acres to change it.';
  end if;
  return new;
end;
$$;

drop trigger if exists lock_profile_birthday on profiles;
create trigger lock_profile_birthday
  before update of birthday on profiles
  for each row execute function public.lock_profile_birthday();

-- ── 3. One-time: Christina's Club delivery stops (Nov 12 2026) ──────────────
-- After this, manage the setting with the checkbox in Admin → Locations.
-- Re-running this line would re-tick these two, so don't re-run it later.
update pickup_locations set club_only = true where name in ('Rural King', 'Kohls Parking Lot');
