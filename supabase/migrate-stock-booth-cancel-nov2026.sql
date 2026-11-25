-- Item availability also follows booth orders, Sold Today and cancellations — Nov 2026
-- Builds on migrate-stock-countdown-nov2026.sql (website orders count down).
--   • Booth / phone orders count down, like website orders.
--   • Sold Today taps count down; Undo puts the item back.
--   • Cancelling an order puts its items back; un-cancelling takes them again.
-- Orders and sales from before this migration were never counted, so they
-- are never put back either (stock_counted stays null / false for them).
-- Safe to re-run.

-- ── 1. One function that moves a count up or down ──────────────────────────
-- Same rules as checkout: a flavor/size with a number is counted, a blank
-- count is unlimited, a flavor with no count uses the item's own count.
-- Never goes below 0.
create or replace function public.adjust_product_stock(
  p_product_id text,
  p_variation  text,
  p_delta      int          -- negative = sold, positive = put back
)
returns void
language plpgsql
set search_path = public
as $$
declare
  r        product_details%rowtype;
  v        jsonb;
  new_vars jsonb := '[]'::jsonb;
  matched  boolean := false;
  counted  boolean := false;
begin
  if p_delta is null or p_delta = 0 or coalesce(p_product_id, '') in ('', 'custom') then return; end if;

  select * into r from product_details where stripe_product_id = p_product_id for update;
  if not found then return; end if;

  if coalesce(p_variation, '') <> '' and jsonb_typeof(r.variations) = 'array' then
    for v in select value from jsonb_array_elements(r.variations) loop
      if not matched and v->>'name' = p_variation and v ? 'quantity' then
        matched := true;
        if jsonb_typeof(v->'quantity') = 'number' then
          v := jsonb_set(v, '{quantity}', to_jsonb(greatest((v->>'quantity')::numeric::int + p_delta, 0)));
          counted := true;
        end if;
      end if;
      new_vars := new_vars || jsonb_build_array(v);
    end loop;

    if counted then
      update product_details set variations = new_vars, updated_at = now()
       where stripe_product_id = p_product_id;
    end if;
    if matched then return; end if;
  end if;

  if r.quantity is not null then
    update product_details set quantity = greatest(quantity + p_delta, 0), updated_at = now()
     where stripe_product_id = p_product_id;
  end if;
end;
$$;

-- Kept for the webhook already deployed; now just a wrapper
create or replace function public.decrement_product_stock(p_product_id text, p_variation text, p_qty int)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_qty is null or p_qty < 1 then return; end if;
  perform adjust_product_stock(p_product_id, p_variation, -p_qty);
end;
$$;

-- ── 2. Remember the flavor/size on each order line, and whether an order
--       has had its stock taken ────────────────────────────────────────────
alter table order_items add column if not exists variation_name text;
alter table orders      add column if not exists stock_counted  boolean;   -- null = from before counting

-- Takes stock for every line of an order, once. Called by the Stripe webhook
-- (website orders) and /api/admin/create-order (booth orders).
create or replace function public.take_order_stock(p_order_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  o  orders%rowtype;
  it record;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or o.stock_counted is true or o.status = 'cancelled' then return; end if;
  for it in select stripe_product_id, variation_name, quantity from order_items where order_id = p_order_id loop
    perform adjust_product_stock(it.stripe_product_id, it.variation_name, -coalesce(it.quantity, 0));
  end loop;
  update orders set stock_counted = true where id = p_order_id;
end;
$$;

-- ── 3. Cancel puts stock back; un-cancel takes it again ─────────────────────
-- Runs when an admin changes an order's status (only admins can update orders).
create or replace function public.orders_stock_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  it    record;
  dir   int := 0;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and old.stock_counted is true then
    dir := 1;                       -- put back
    new.stock_counted := false;
  elsif old.status = 'cancelled' and new.status is distinct from 'cancelled' and old.stock_counted is false then
    dir := -1;                      -- take again
    new.stock_counted := true;
  end if;
  if dir <> 0 then
    for it in select stripe_product_id, variation_name, quantity from order_items where order_id = new.id loop
      perform adjust_product_stock(it.stripe_product_id, it.variation_name, dir * coalesce(it.quantity, 0));
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_stock_on_cancel on orders;
create trigger orders_stock_on_cancel
  before update of status on orders
  for each row execute function public.orders_stock_on_cancel();

-- ── 4. Sold Today: a tap takes one, Undo puts it back ───────────────────────
alter table booth_sales add column if not exists variation_name text;
-- Existing rows were never counted (false); every new row is (true)
alter table booth_sales add column if not exists stock_counted boolean not null default false;
alter table booth_sales alter column stock_counted set default true;

create or replace function public.booth_sales_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') and old.stock_counted then
    perform adjust_product_stock(old.stripe_product_id, old.variation_name, old.quantity);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.stock_counted then
    perform adjust_product_stock(new.stripe_product_id, new.variation_name, -new.quantity);
  end if;
  return null;
end;
$$;

drop trigger if exists booth_sales_stock on booth_sales;
create trigger booth_sales_stock
  after insert or delete or update of stripe_product_id, variation_name, quantity, stock_counted on booth_sales
  for each row execute function public.booth_sales_stock();

-- ── 5. Who may call what ───────────────────────────────────────────────────
-- Shoppers' browsers can't move counts. The server (service role) can; the
-- triggers above run on admin writes only (RLS) and act as the table owner.
revoke all on function public.adjust_product_stock(text, text, int)    from public, anon, authenticated;
revoke all on function public.decrement_product_stock(text, text, int) from public, anon, authenticated;
revoke all on function public.take_order_stock(uuid)                   from public, anon, authenticated;
revoke all on function public.orders_stock_on_cancel()                 from public, anon, authenticated;
revoke all on function public.booth_sales_stock()                      from public, anon, authenticated;
grant execute on function public.adjust_product_stock(text, text, int)    to service_role;
grant execute on function public.decrement_product_stock(text, text, int) to service_role;
grant execute on function public.take_order_stock(uuid)                   to service_role;
