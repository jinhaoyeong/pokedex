import { getEurToUsdRate } from "@/lib/catalog/fx-rates";
import { generateSetMappings, persistSetMappings } from "@/lib/catalog/set-mappings";
import { isDatabaseEnabled, prisma } from "@/lib/db";

export type IngestStats = {
  setMappings: number;
  fxRate?: number;
  database: boolean;
};

export async function runCatalogIngest(): Promise<IngestStats> {
  const mappings = await generateSetMappings();
  const persisted = await persistSetMappings(mappings);
  const fx = await getEurToUsdRate();

  if (isDatabaseEnabled() && prisma) {
    await prisma.fxRate.upsert({
      where: { base_quote: { base: "EUR", quote: "USD" } },
      create: {
        base: "EUR",
        quote: "USD",
        rate: fx.rate,
        source: fx.snapshot.source,
      },
      update: {
        rate: fx.rate,
        source: fx.snapshot.source,
        fetchedAt: new Date(),
      },
    });

    await prisma.ingestJob.create({
      data: {
        jobType: "catalog",
        status: "completed",
        stats: {
          setMappings: mappings.length,
          fxRate: fx.rate,
          persisted,
        },
        finishedAt: new Date(),
      },
    });
  }

  return {
    setMappings: mappings.length,
    fxRate: fx.rate,
    database: isDatabaseEnabled(),
  };
}
