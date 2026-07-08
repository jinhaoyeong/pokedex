CREATE POLICY "Allow public read access" ON public.cards_catalog FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "Allow public read access" ON public.card_visuals FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "Allow public read access" ON public.api_price_cache FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "Allow public read access" ON public.api_population_cache FOR SELECT USING (true);
