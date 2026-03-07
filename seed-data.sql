-- Bloomin' Acres — Seed Data
-- Run this AFTER supabase-schema.sql to populate the database with existing data.
-- NOTE: Image URLs reference the old Supabase project. Re-upload images via the
-- dashboard and these URLs will be replaced automatically.

-- ── Menu Schedule ────────────────────────────────────────────────────────────

INSERT INTO menu_schedule (id, start_date, end_date, updated_at)
VALUES (1, '2026-03-18', '2026-03-25', '2026-03-05 02:51:25.082+00');

-- ── Site Content ─────────────────────────────────────────────────────────────

INSERT INTO site_content (key, value) VALUES
  ('landing-hero', 'https://fzrhvlzataohotaruwaj.supabase.co/storage/v1/object/public/site-images/landing-hero.png'),
  ('landing-card-1', 'https://fzrhvlzataohotaruwaj.supabase.co/storage/v1/object/public/site-images/landing-card-1.png'),
  ('landing-card-2', 'https://fzrhvlzataohotaruwaj.supabase.co/storage/v1/object/public/site-images/landing-card-2.png'),
  ('landing-card-3', 'https://fzrhvlzataohotaruwaj.supabase.co/storage/v1/object/public/site-images/landing-card-3.png'),
  ('lp-email', 'c.lefler@bloominacresmarket.com'),
  ('lp-welcome-heading', ''),
  ('lp-welcome-body', E'What began as a personal pursuit of healthier living has grown into something we''re proud to share with our community. Bloomin'' Acres Farm was born from a simple belief \u2014 that fresh, nutrient-rich food has the power to transform everyday meals and everyday lives.\n\nNestled on 10 acres just south of Hope, Indiana, our farm is home to a greenhouse where we cultivate organically grown microgreens, along with farm-fresh produce, eggs, and honey. Our carefully tended selection of microgreens \u2014 including broccoli, arugula, pea shoots, radish, and sunflower \u2014 are grown with intention, bringing vibrant flavor, nutrition, and beauty to your plate.\n\nIn 2025, we expanded our farm family with the launch of our micro bakery. With a little help from our happy hens and busy bees, we now craft fresh-baked breads (traditional, sourdough, and gluten-free), cookies, scones, muffins, and more \u2014 each made with farm-fresh eggs and honey.\n\nSustainability and quality are at the heart of everything we do. We are proud members of Indiana Grown, a community dedicated to celebrating and supporting local Indiana farmers. You can find us sharing our harvest at the Franklin and Bargersville Farmers Markets, where we look forward to connecting with the neighbors and food lovers who make this work so meaningful.\n\nAt Bloomin'' Acres Farm, we''re more than a farm \u2014 we''re an invitation to slow down, eat well, and join us on a journey toward a healthier, more connected way of living. We''re so glad you''re here.');

-- ── Product Details ──────────────────────────────────────────────────────────

INSERT INTO product_details (stripe_product_id, description, image_url, variations, ingredients) VALUES
  ('prod_SLzGeddme4IHg9',
   E'Headline: Real Food for Your Real Life\nWhether you''re conquering a mountain trail, navigating the school carpool, or fueling a marathon work day, our freeze-dried fruits and treats are designed to keep up with you. We''ve taken the best locally grown or sourced from organic producers and made it portable, durable, and\u2014most importantly\u2014delicious.',
   '',
   '[{"name":"Apple Fries","price_delta":0},{"name":"Bananas","price_delta":0},{"name":"Blackberries","price_delta":0},{"name":"Blueberries","price_delta":0},{"name":"Raspberries","price_delta":0},{"name":"Strawberries","price_delta":0}]'::jsonb,
   NULL),

  ('prod_SMf366ypyAtGEL',
   '',
   '',
   '[{"name":"Cheesecake Bites","price_delta":0},{"name":"Yogurt Bites","price_delta":0}]'::jsonb,
   NULL),

  ('prod_U5s86nTaqh6vpw',
   E'Better Bread, Better Pizza.\nNot all pizza crusts are created equal. Our sourdough bases are made using a traditional fermentation process that breaks down gluten and phytic acid, making them easier on your digestion and richer in flavor. Available in 10" (Personal) and 12" (Family Size), these crusts offer a nutrient-dense alternative to mass-produced doughs, with no artificial preservatives or additives. Just flour, water, salt, and time.\n\nBoth sizes are sold in packages of (2) crusts.',
   '',
   '[{"name":"10\"","quantity":1,"available":true,"ingredients":"","price_delta":0},{"name":"12\"","quantity":1,"available":true,"ingredients":"","price_delta":0}]'::jsonb,
   ''),

  ('prod_SRy5Tpm0xMcx4i',
   E'Pasture-Raised Organic Eggs\nSun-kissed eggs from pasture-raised hens fed only organic, non-GMO grain\u2014each shell a little farm-fresh promise. Bright, buttery yolks and firm whites that taste like slow mornings, open fields, and hens that had a very good day.',
   '',
   '[{"name":"Large","price_delta":0},{"name":"Extra-Large","price_delta":100}]'::jsonb,
   NULL),

  ('prod_U5o2WCbQJcwpOG',
   E'Our selection changes with the seasons to showcase the best each month offers. Spring brings tender greens, radishes, and early herbs; summer yields tomatoes, peppers, cucumbers, and sweet corn; fall offers winter squash, beets, and storage carrots; winter greenhouse harvests include salad mixes, microgreens, and hardy herbs. Each item is picked the same day it''s sold whenever possible to preserve flavor and nutrition.',
   '',
   '[{"name":"Onions (single bunch)","price_delta":0},{"name":"Radish (single bunch)","price_delta":0}]'::jsonb,
   NULL),

  ('prod_U5ol8lXTHiyrai',
   E'Headline: Clean, Crisp, and Cultivated in Water\nExperience the purity of sprouts grown without a grain of soil. We cultivate our bean sprouts in small batches using specialized jars and filtered water over a meticulous 3\u20134 day cycle. This soil-free method ensures a cleaner, snappier sprout that''s ready to rinse and eat straight from the package. Farm-fresh quality, grown with nothing but patience and pure water.',
   '',
   '[{"name":"Alfalfa","price_delta":0},{"name":"Bean","price_delta":0}]'::jsonb,
   NULL),

  ('prod_QCKQJeytG1q6Fu',
   '',
   '',
   '[{"name":"Kickin'' It Up (Spicy Salad Blend)","price_delta":0},{"name":"NutriBlast (Superfood Blend)","price_delta":0},{"name":"Fresh Fixin''s (Basic Salad Blend)","price_delta":0},{"name":"Sunnies","price_delta":0},{"name":"Broccoli","price_delta":0},{"name":"Radish Mix","price_delta":0},{"name":"Wasa-BANG (Wasabi Blend)","price_delta":0}]'::jsonb,
   NULL),

  ('prod_SLzDhaCCh9Unlo',
   E'Headline: One Ingredient. Zero Compromises.\nGive your dog the protein they crave without the mystery fillers. Our freeze-dried treats are crafted from 100% pure beef and chicken liver\u2014and nothing else. No grains, no by-products, and absolutely no artificial additives. We use a gentle freeze-drying process to lock in the natural nutrients and rich aroma that dogs go wild for, providing a clean, healthy snack you can feel good about.',
   '',
   '[{"name":"Chicken Liver","price_delta":0},{"name":"Beef Liver","price_delta":0}]'::jsonb,
   NULL),

  ('prod_SMf1HTsirhpn7L',
   '',
   '',
   '[{"name":"Bananas","price_delta":0},{"name":"Blueberries","price_delta":0},{"name":"Raspberries","price_delta":0},{"name":"Strawberries","price_delta":0},{"name":"Apple Fries","price_delta":0}]'::jsonb,
   NULL),

  ('prod_U5shMVSx3BJjLK',
   E'The Ultimate Nooks & Crannies Experience\nSay goodbye to bland, doughy muffins. Our sourdough English muffins are slow-fermented for 24 hours to create a deep, tangy flavor and those iconic air pockets perfect for pooling melted butter or local honey.  We don''t skimp on this breakfast staple. Our muffins are generously sized to hold one full egg, crispy bacon, and melted cheese with room to spare. Whether you want to add avocado, saut\u00e9ed greens, or your favorite microgreens, these muffins are built to satisfy every hearty appetite. Start your day with a breakfast that''s as big on flavor as it is on size.\n\nSold by the \u00bd dozen',
   '',
   '[]'::jsonb,
   NULL),

  ('prod_U5s5XLxzilTiwy',
   '',
   '',
   '[{"name":"Jalapeno Cheddar","price_delta":200},{"name":"Classic","price_delta":0},{"name":"Rye Wheat","price_delta":0},{"name":"Oatmeal Honey Whole Wheat","price_delta":0}]'::jsonb,
   NULL),

  ('prod_U5cfzag6JkbpV3',
   E'A naturally leavened sourdough loaf crafted from organic, stone-milled flours, hydrated with fermented fruit water, and enriched with organic eggs. The result is a loaf that balances rustic authenticity with refined technique: a deeply caramelized crust, an open yet tender crumb, and a layered flavor profile that evolves from bright fruit-ferment acidity to a rich, savory finish.\n\nMAIN INGREDIENTS:\nOrganic, stone-milled whole flours, sourdough starter (fermented wild yeast), pasture-raised organic eggs, salt',
   '',
   '[{"name":"Chili Crunch Bacon Cheddar","quantity":1,"available":true,"ingredients":"","price_delta":200},{"name":"Classic","quantity":1,"available":true,"ingredients":"","price_delta":0},{"name":"Dill Pickle & Havarti","quantity":0,"available":false,"ingredients":"","price_delta":0},{"name":"Guinness Cheddar Rye","quantity":0,"available":false,"ingredients":"","price_delta":200},{"name":"Jalape\u00f1o & Cheddar","quantity":0,"available":false,"ingredients":"","price_delta":200},{"name":"Triple Cheese","quantity":1,"available":true,"ingredients":"","price_delta":0}]'::jsonb,
   '');
