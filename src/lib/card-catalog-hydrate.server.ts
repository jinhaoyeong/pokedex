import "server-only";

import {
  applyCatalogFactsPatch,
  catalogMarketName,
  catalogStageFromSubtypes,
  inferStageFromCardName,
  needsCatalogFactHydration,
  type CatalogFactsPatch,
} from "@/lib/card-catalog-facts";
import { attachFinishMarketsToCard } from "@/lib/card-finish";
import {
  fetchTcgdexJson,
  normalizeTcgdexImageUrl,
  TCGDEX_API_BASE_URL,
} from "@/lib/pokemon-tcg/tcgdex-normalizers";
import type { PokemonTcgCardApiResponse, TcgdexCardResponse } from "@/lib/pokemon-tcg/api-types";
import { persistCard } from "@/lib/pokemon-cards-cache.server";
import type { TcgCard } from "@/types/pokemon";

const POKEMON_TCG_API_BASE_URL = "https://api.pokemontcg.io/v2";
const CATALOG_HYDRATE_BUDGET_MS = 4_000;
const CATALOG_FACT_TIMEOUT_MS = 2_000;

const SET_ID_ALIASES: Record<string, string[]> = {
  me2pt5: ["me02.5", "me2.5"],
  "me02.5": ["me2pt5", "me2.5"],
  "me2.5": ["me2pt5", "me02.5"],
  sv8pt5: ["sv08.5", "sv8.5"],
  "sv08.5": ["sv8pt5", "sv8.5"],
  "sv8.5": ["sv8pt5", "sv08.5"],
  sv3pt5: ["sv03.5", "sv3.5"],
  "sv03.5": ["sv3pt5", "sv3.5"],
  "sv3.5": ["sv3pt5", "sv03.5"],
  sv6pt5: ["sv06.5", "sv6.5"],
  "sv06.5": ["sv6pt5", "sv6.5"],
  "sv6.5": ["sv6pt5", "sv06.5"],
};

type PokemonTcgDetailCard = PokemonTcgCardApiResponse["data"][number] & {
  subtypes?: string[];
  attacks?: Array<{
    name: string;
    cost?: string[];
    damage?: string | number;
    text?: string;
  }>;
  nationalPokedexNumbers?: number[];
  convertedRetreatCost?: number;
  legalities?: {
    standard?: string;
    expanded?: string;
  };
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeNumber(value?: string | null) {
  return (value ?? "").trim().replace(/^0+(?=\d)/, "");
}

function unique(values: Array<string | undefined | null>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function setIdCandidates(card: TcgCard) {
  const slugId = card.slug.includes("--") ? card.slug.split("--").slice(1).join("--") : card.slug;
  const officialPc = slugId.match(/^official-pc-([a-z0-9.]+)-(\d+)$/i);
  const primary = unique([
    card.setId,
    card.setCode,
    officialPc?.[1],
    card.id.split("-")[0],
  ]);

  return unique(
    primary.flatMap((setId) => {
      const lower = setId.toLowerCase();
      return [setId, lower, setId.toUpperCase(), ...(SET_ID_ALIASES[lower] ?? [])];
    }),
  );
}

function cardIdCandidates(card: TcgCard) {
  const number = normalizeNumber(card.collectorNumber);
  const padded = number.padStart(3, "0");
  const slugId = card.slug.includes("--") ? card.slug.split("--").slice(1).join("--") : card.id;

  return unique([
    card.id,
    slugId,
    ...setIdCandidates(card).flatMap((setId) => [`${setId}-${number}`, `${setId}-${padded}`]),
  ])
    .filter((id) => !/^official-pc-/i.test(id) && !id.includes("--"))
    .sort((left, right) => Number(right.includes(".")) - Number(left.includes(".")));
}

async function firstResolved<T>(tasks: Array<Promise<T | null>>): Promise<T | null> {
  if (!tasks.length) {
    return null;
  }

  return new Promise((resolve) => {
    let remaining = tasks.length;
    let settled = false;

    for (const task of tasks) {
      void task
        .then((value) => {
          if (!settled && value) {
            settled = true;
            resolve(value);
            return;
          }

          remaining -= 1;
          if (!settled && remaining === 0) {
            resolve(null);
          }
        })
        .catch(() => {
          remaining -= 1;
          if (!settled && remaining === 0) {
            resolve(null);
          }
        });
    }
  });
}

async function fetchJson<T>(url: string, timeoutMs = CATALOG_FACT_TIMEOUT_MS): Promise<T | null> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function patchFromPokemonTcg(card: PokemonTcgDetailCard): CatalogFactsPatch {
  const fetchedAt = card.tcgplayer?.updatedAt ?? nowIso();

  return {
    collectorNumber: card.number,
    setCode: card.set.id,
    setId: card.set.id,
    name: card.name,
    englishName: card.name,
    hp: card.hp,
    types: card.types ?? [],
    artist: card.artist,
    rarity: card.rarity,
    stage: catalogStageFromSubtypes(card.subtypes),
    dexIds: card.nationalPokedexNumbers,
    attacks: card.attacks?.map((attack) => ({
      name: attack.name,
      cost: attack.cost,
      damage: attack.damage,
      effect: attack.text,
    })),
    retreatCost: card.convertedRetreatCost ?? null,
    legalities: {
      standard: card.legalities?.standard === "Legal",
      expanded: card.legalities?.expanded === "Legal",
    },
    setName: card.set.name,
    setEnglishName: card.set.name,
    setPrintedTotal: card.set.printedTotal,
    setTotal: card.set.total,
    image: card.images?.large ?? card.images?.small,
    imageStatus: card.images?.large || card.images?.small ? "official" : undefined,
    sources: [
      {
        source: "PokemonTCG public catalog",
        status: "verified",
        fetchedAt,
        confidence: 0.86,
        note: "Print facts hydrated from the live Pokemon TCG catalog.",
      },
    ],
  };
}

function patchFromTcgdex(card: TcgdexCardResponse): CatalogFactsPatch {
  const image = normalizeTcgdexImageUrl(card.image) ?? undefined;

  return {
    collectorNumber: card.localId,
    setCode: card.set.id,
    setId: card.set.id,
    name: card.name,
    localizedName: card.name,
    englishName: /[A-Za-z]/.test(card.name) ? card.name : undefined,
    hp: card.hp == null ? undefined : String(card.hp),
    types: card.types ?? [],
    artist: card.illustrator,
    rarity: card.rarity,
    stage: card.stage ?? inferStageFromCardName(card.name),
    dexIds: card.dexId,
    attacks: card.attacks?.map((attack) => ({
      name: attack.name,
      cost: attack.cost,
      damage: attack.damage,
      effect: attack.effect,
    })),
    retreatCost: card.retreat ?? null,
    legalities: card.legal,
    setName: card.set.name,
    setLocalizedName: card.set.name,
    setPrintedTotal: card.set.cardCount?.official,
    setTotal: card.set.cardCount?.total,
    image,
    imageStatus: image ? "official" : undefined,
    sources: [
      {
        source: "TCGdex",
        status: "verified",
        fetchedAt: card.updated ?? nowIso(),
        confidence: 0.84,
        note: "Print facts hydrated from the live TCGdex catalog.",
      },
    ],
  };
}

async function fetchPokemonTcgFacts(card: TcgCard): Promise<CatalogFactsPatch | null> {
  const byId = await firstResolved(
    cardIdCandidates(card)
      .slice(0, 4)
      .map(async (id) => {
        const payload = await fetchJson<{ data?: PokemonTcgDetailCard }>(
          `${POKEMON_TCG_API_BASE_URL}/cards/${encodeURIComponent(id)}`,
        );
        return payload?.data?.name ? patchFromPokemonTcg(payload.data) : null;
      }),
  );

  if (byId) {
    return byId;
  }

  const name = catalogMarketName(card) || (/[A-Za-z]/.test(card.name) ? card.name : "");
  const number = normalizeNumber(card.collectorNumber);
  if (!name || !number) {
    return null;
  }

  const query = `name:"${name.replace(/"/g, "")}" number:${number}`;
  const searched = await fetchJson<PokemonTcgCardApiResponse>(
    `${POKEMON_TCG_API_BASE_URL}/cards?q=${encodeURIComponent(query)}&pageSize=5`,
  );
  const match = searched?.data?.find((candidate) => {
    const sameNumber = normalizeNumber(candidate.number) === number;
    const sameSet = setIdCandidates(card).some(
      (setId) => setId.toLowerCase() === candidate.set.id.toLowerCase(),
    );
    return sameNumber && sameSet;
  });

  return match ? patchFromPokemonTcg(match) : null;
}

async function fetchTcgdexFacts(card: TcgCard): Promise<CatalogFactsPatch | null> {
  const language = card.language === "en" ? "en" : card.language;
  const languages = unique([language, "en"]);
  const ids = cardIdCandidates(card).slice(0, 4);
  const preferredId = ids[0];

  if (preferredId) {
    const preferred = await fetchTcgdexJson<TcgdexCardResponse>(
      `${TCGDEX_API_BASE_URL}/${language}/cards/${encodeURIComponent(preferredId)}`,
    ).catch(() => null);

    if (preferred?.localId && (preferred.types?.length || preferred.hp)) {
      return patchFromTcgdex(preferred);
    }
  }

  const byId = await firstResolved(
    languages.flatMap((lang) =>
      ids.map((id) =>
        fetchTcgdexJson<TcgdexCardResponse>(
          `${TCGDEX_API_BASE_URL}/${lang}/cards/${encodeURIComponent(id)}`,
        )
          .then((detail) => (detail?.localId ? patchFromTcgdex(detail) : null))
          .catch(() => null),
      ),
    ),
  );

  if (byId) {
    return byId;
  }

  const name = catalogMarketName(card) || card.name;
  const number = normalizeNumber(card.collectorNumber);
  if (!name || !number) {
    return null;
  }

  const briefs = await fetchTcgdexJson<Array<{ id: string }>>(
    `${TCGDEX_API_BASE_URL}/${language}/cards?name=${encodeURIComponent(name)}&localId=${encodeURIComponent(number)}`,
  ).catch(() => null);
  const briefId = briefs?.[0]?.id;
  if (!briefId) {
    return null;
  }

  const detail = await fetchTcgdexJson<TcgdexCardResponse>(
    `${TCGDEX_API_BASE_URL}/${language}/cards/${encodeURIComponent(briefId)}`,
  ).catch(() => null);

  return detail ? patchFromTcgdex(detail) : null;
}

function isUsableFactsPatch(patch: CatalogFactsPatch) {
  return Boolean(patch.types?.length || (patch.hp && patch.hp !== "-"));
}

function hasCompletePrintFacts(patch: CatalogFactsPatch) {
  return Boolean(
    isUsableFactsPatch(patch) &&
      (patch.setPrintedTotal || patch.setTotal) &&
      (patch.stage || patch.dexIds?.length),
  );
}

export async function fetchLiveCatalogFacts(card: TcgCard): Promise<CatalogFactsPatch | null> {
  const tcgdex = await fetchTcgdexFacts(card);
  if (tcgdex && hasCompletePrintFacts(tcgdex)) {
    return tcgdex;
  }

  if (card.language !== "en") {
    return tcgdex && isUsableFactsPatch(tcgdex) ? tcgdex : null;
  }

  const pokemon = await fetchPokemonTcgFacts(card);
  const patches = [tcgdex, pokemon].filter(
    (patch): patch is CatalogFactsPatch => Boolean(patch && isUsableFactsPatch(patch)),
  );

  return patches[0]
    ? patches.slice(1).reduce<CatalogFactsPatch>(
        (merged, patch) => ({
          ...merged,
          hp: merged.hp && merged.hp !== "-" ? merged.hp : patch.hp,
          types: merged.types?.length ? merged.types : patch.types,
          artist: merged.artist && merged.artist !== "Unknown" ? merged.artist : patch.artist,
          rarity: merged.rarity ? merged.rarity : patch.rarity,
          stage: merged.stage ?? patch.stage,
          dexIds: merged.dexIds?.length ? merged.dexIds : patch.dexIds,
          attacks: merged.attacks?.length ? merged.attacks : patch.attacks,
          retreatCost: merged.retreatCost ?? patch.retreatCost,
          legalities: merged.legalities ?? patch.legalities,
          setName: merged.setName ?? patch.setName,
          setEnglishName: merged.setEnglishName ?? patch.setEnglishName,
          setLocalizedName: merged.setLocalizedName ?? patch.setLocalizedName,
          setPrintedTotal: merged.setPrintedTotal ?? patch.setPrintedTotal,
          setTotal: merged.setTotal ?? patch.setTotal,
          image: merged.image ?? patch.image,
          imageStatus: merged.imageStatus ?? patch.imageStatus,
          sources: [...(merged.sources ?? []), ...(patch.sources ?? [])],
        }),
        patches[0],
      )
    : null;
}

export async function hydrateThinCatalogCard(
  card: TcgCard,
  options: { persist?: boolean; timeoutMs?: number } = {},
): Promise<TcgCard> {
  const timeoutMs = options.timeoutMs ?? CATALOG_HYDRATE_BUDGET_MS;
  const neededFacts = needsCatalogFactHydration(card);
  let next = card;

  if (neededFacts) {
    const patch = await Promise.race([
      fetchLiveCatalogFacts(card),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    if (patch) {
      next = applyCatalogFactsPatch(card, patch);
    }
  }

  next = attachFinishMarketsToCard(next);

  if (options.persist !== false && neededFacts && !needsCatalogFactHydration(next)) {
    void persistCard(next, { context: "detail" }).catch(() => undefined);
  }

  return next;
}
