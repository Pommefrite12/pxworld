-- Default price: €0.10 per pixel (was €1).
--
-- A pixel is about one square kilometre at the equator, so 10 cents a pixel is roughly 10 cents a km². Only the
-- untouched factory default is lowered: a price an admin has set on purpose (anything other than 100) is left alone.
-- Orders already created keep the price they were made with (orders.unit_price_cents is a snapshot).
update public.app_settings
   set value = '10'::jsonb
 where key = 'price_unit_cents'
   and value = '100'::jsonb;
