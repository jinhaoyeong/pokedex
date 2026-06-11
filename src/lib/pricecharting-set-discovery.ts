import "server-only";

import {
  getCachedDiscoveredPriceChartingSlug,
  getLocalizedSetMarketProfile,
  getPriceChartingSetSlugVariants,
  registerDiscoveredSetProfile,
  resolveLocalizedSetEnglishName,
} from "@/lib/localized-set-market";
import { fetchPublicPageText } from "@/lib/public-page-fetch";

type LookupOptions = {
  setCode?: string;
  language?: string;
};

const discoveryInFlight = new Map<string, Promise<string | undefined>>();

function slugifyForDiscovery(text: string) {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function isValidPriceChartingSetPage(html: string, slug: string) {
  if (html.length < 1_500) {
    return false;
  }

  const head = html.slice(0, 8_000).toLowerCase();

  if (head.includes("page not found") || head.includes("404 error")) {
    return false;
  }

  return (
    /population|card list|pricecharting/i.test(html) &&
    (head.includes(slug.toLowerCase()) || /\/game\/pokemon|\/console\//i.test(html))
  );
}

async function probePriceChartingSetSlug(slug: string) {
  const url = `https://www.pricecharting.com/console/${slug}`;

  try {
    const html = await fetchPublicPageText(url, 86_400);
    return isValidPriceChartingSetPage(html, slug);
  } catch {
    return false;
  }
}

async function discoverSlugForLocalizedSet(setCode: string, englishName: string) {
  const candidates = [
    `pokemon-japanese-${slugifyForDiscovery(englishName)}`,
    `pokemon-japanese-${setCode.toLowerCase()}`,
    `pokemon-${setCode.toLowerCase()}`,
  ];

  for (const slug of [...new Set(candidates.filter(Boolean))]) {
    if (await probePriceChartingSetSlug(slug)) {
      return slug;
    }
  }

  return undefined;
}

export async function resolvePriceChartingSetSlugs(
  setName: string,
  options: LookupOptions = {},
): Promise<string[]> {
  const syncVariants = getPriceChartingSetSlugVariants(setName, options);
  const setCode = options.setCode?.trim().toUpperCase() ?? "";

  if (!setCode) {
    return syncVariants;
  }

  const cached = getCachedDiscoveredPriceChartingSlug(setCode);

  if (cached) {
    return [cached, ...syncVariants.filter((slug) => slug !== cached)];
  }

  const profile = getLocalizedSetMarketProfile(setCode);

  if (profile?.priceChartingSlug) {
    return syncVariants;
  }

  const isLocalizedImport =
    options.language === "ja" ||
    options.language === "ko" ||
    options.language?.startsWith("zh");

  if (!isLocalizedImport) {
    return syncVariants;
  }

  let discovery = discoveryInFlight.get(setCode);

  if (!discovery) {
    const englishName = profile?.englishName ?? resolveLocalizedSetEnglishName(setCode, setName);

    discovery = (englishName
      ? discoverSlugForLocalizedSet(setCode, englishName)
      : Promise.resolve(undefined)
    ).finally(() => {
      discoveryInFlight.delete(setCode);
    });
    discoveryInFlight.set(setCode, discovery);
  }

  const discovered = await discovery;

  if (discovered) {
    registerDiscoveredSetProfile(setCode, {
      englishName: profile?.englishName ?? resolveLocalizedSetEnglishName(setCode, setName) ?? setName,
      priceChartingSlug: discovered,
    });

    return [discovered, ...syncVariants.filter((slug) => slug !== discovered)];
  }

  return syncVariants;
}
