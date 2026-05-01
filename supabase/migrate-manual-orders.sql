-- Manual Order Creation — allows admins to place orders on behalf of customers
-- (e.g. phone orders for customers who struggle with technology)

-- Allow orders without a registered user account (walk-in / phone orders)
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;

-- Track that an order was manually created by an admin
ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_created boolean NOT NULL DEFAULT false;
