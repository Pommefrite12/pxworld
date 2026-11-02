-- Default price: €0.50 per pixel (was €0.10 after migration 7, €1 before).
--
-- Only an untouched factory default is moved: a database still holding 100 (never migrated) or 10 (migration 7) goes to 50,
-- a price an admin chose on purpose (anything else) is left alone. Orders already created keep the price they were made
-- with (orders.unit_price_cents is a snapshot). Re-running it is harmless.
update public.app_settings
   set value = '50'::jsonb
 where key = 'price_unit_cents'
   and value in ('100'::jsonb, '10'::jsonb);
