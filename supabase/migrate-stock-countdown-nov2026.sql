-- Item availability counts down as website orders are paid — Nov 2026
-- Admin → Catalogue sets how many of each item (or each flavor/size) are
-- available. Checkout already refused orders larger than that count, but
-- nothing ever subtracted what was sold. The Stripe webhook now calls this
-- once per order line, right after the paid order is saved.
-- Safe to re-run.

create or replace function public.decrement_product_stock(
  p_product_id text,
  p_variation  text,
  p_qty        int
)
returns void
language plpgsql
set search_path = public
as $$
declare
  r        product_details%rowtype;
  v        jsonb;
  new_vars jsonb := '[]'::jsonb;
  matched  boolean := false;   -- found the flavor/size by name
  counted  boolean := false;   -- …and it has a number to count down
begin
  if p_qty is null or p_qty < 1 then return; end if;

  -- Lock the row so two orders at the same moment can't both read the old count
  select * into r from product_details where stripe_product_id = p_product_id for update;
  if not found then return; end if;

  -- Flavor/size: same rule as checkout — a variation with a number is counted;
  -- one with a blank count is unlimited; one with no count at all falls back
  -- to the item's own count.
  if coalesce(p_variation, '') <> '' and jsonb_typeof(r.variations) = 'array' then
    for v in select value from jsonb_array_elements(r.variations) loop
      if not matched and v->>'name' = p_variation and v ? 'quantity' then
        matched := true;
        if jsonb_typeof(v->'quantity') = 'number' then
          v := jsonb_set(v, '{quantity}', to_jsonb(greatest((v->>'quantity')::numeric::int - p_qty, 0)));
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

  -- Item without flavors (or a flavor with no count of its own)
  if r.quantity is not null then
    update product_details set quantity = greatest(quantity - p_qty, 0), updated_at = now()
     where stripe_product_id = p_product_id;
  end if;
end;
$$;

-- Only the server (service role, used by the Stripe webhook) may call it —
-- never shoppers' browsers.
revoke all on function public.decrement_product_stock(text, text, int) from public, anon, authenticated;
grant execute on function public.decrement_product_stock(text, text, int) to service_role;
