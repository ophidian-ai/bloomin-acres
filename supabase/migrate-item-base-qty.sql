-- Base item quantity for products without variations
-- When a product has no variations, this column tracks its stock level.
-- Checkout validation checks this when no variation-specific quantity exists.

alter table product_details
  add column if not exists quantity integer;
