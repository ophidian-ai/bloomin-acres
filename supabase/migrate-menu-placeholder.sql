-- Menu placeholder message — shown on the public menu page when the schedule is outside its date range

ALTER TABLE menu_schedule ADD COLUMN IF NOT EXISTS message text;
