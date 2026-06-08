import { runCatalogIngest } from "../src/lib/ingest/run-ingest";

async function main() {
  const stats = await runCatalogIngest();
  console.log(
    JSON.stringify(
      {
        ok: true,
        ...stats,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
