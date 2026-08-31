/**
 * The search form seeds `sets` from getCachedClientSets() so a returning
 * visitor can skip a loading flash after hydration. That cache does not
 * exist on the server, so the hydrating render must ignore it and match
 * the SSR snapshot (usually an empty list + loading) until `mounted`.
 */
export function resolveHydrationSafeSets<T>({
  mounted,
  clientSets,
  initialSets,
  isLoadingSets,
}: {
  mounted: boolean;
  clientSets: T[];
  initialSets: T[];
  isLoadingSets: boolean;
}): { sets: T[]; isLoadingSets: boolean } {
  if (mounted) {
    return { sets: clientSets, isLoadingSets };
  }

  return {
    sets: initialSets,
    isLoadingSets: initialSets.length === 0,
  };
}
