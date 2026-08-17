-- Policies for cards_catalog
ALTER TABLE public.cards_catalog ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "Allow public select" ON public.cards_catalog;--> statement-breakpoint
CREATE POLICY "Allow public select" ON public.cards_catalog FOR SELECT USING (true);--> statement-breakpoint

-- Policies for card_visuals
ALTER TABLE public.card_visuals ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "Allow public select" ON public.card_visuals;--> statement-breakpoint
CREATE POLICY "Allow public select" ON public.card_visuals FOR SELECT USING (true);--> statement-breakpoint

-- Policies for api_price_cache
ALTER TABLE public.api_price_cache ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "Allow public select" ON public.api_price_cache;--> statement-breakpoint
CREATE POLICY "Allow public select" ON public.api_price_cache FOR SELECT USING (true);--> statement-breakpoint

-- Policies for api_population_cache
ALTER TABLE public.api_population_cache ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "Allow public select" ON public.api_population_cache;--> statement-breakpoint
CREATE POLICY "Allow public select" ON public.api_population_cache FOR SELECT USING (true);
