-- Default price: 0.25 per pixel, in euros AND in dollars (was 0.50 after migration 8, and 0.50 in dollars after migration 14).
--
-- Only an untouched factory default is moved: a price still at 50 cents goes to 25, a price an admin chose on purpose (anything else) is left
-- alone. Orders already created keep the price they were made with (orders.unit_price_cents is a snapshot). Re-running it is harmless.
update public.app_settings
   set value = '25'::jsonb
 where key in ('price_unit_cents', 'price_unit_cents_usd')
   and value = '50'::jsonb;
