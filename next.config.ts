import type { NextConfig } from "next";

const OFFICIAL_JP_DATA_FILES = [
  "./data/official-japanese-set-supplements.json",
  "./data/official-japanese-browse-seed.json",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "@huggingface/transformers", "onnxruntime-node"],
  outputFileTracingIncludes: {
    "/*": [
      "./data/pokemon-names.sqlite",
      "./data/pokemon-sets.sqlite",
      "./data/pokemon-sets-seed.json",
      ...OFFICIAL_JP_DATA_FILES,
    ],
    "/api/search-sets": [
      "./data/pokemon-sets.sqlite",
      "./data/pokemon-sets-seed.json",
      ...OFFICIAL_JP_DATA_FILES,
    ],
    "/api/bootstrap": [
      "./data/pokemon-sets.sqlite",
      "./data/pokemon-sets-seed.json",
      "./data/pokemon-names.sqlite",
      ...OFFICIAL_JP_DATA_FILES,
    ],
    "/api/live-search": [
      "./data/pokemon-sets.sqlite",
      "./data/pokemon-sets-seed.json",
      ...OFFICIAL_JP_DATA_FILES,
    ],
    "/search": [
      "./data/pokemon-sets.sqlite",
      "./data/pokemon-sets-seed.json",
      ...OFFICIAL_JP_DATA_FILES,
    ],
    "/api/visual-search": ["./data/scan-visual-index.sqlite"],
  },
  turbopack: {
    root: __dirname,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Marquee uses quality={60}; Next.js 16 only emits configured qualities.
    qualities: [60, 75],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.pokemontcg.io",
      },
      {
        protocol: "https",
        hostname: "images.scrydex.com",
      },
      {
        protocol: "https",
        hostname: "assets.tcgdex.net",
      },
      {
        protocol: "https",
        hostname: "tcgdex.net",
      },
      {
        protocol: "https",
        hostname: "**.tcgdex.net",
      },
      {
        protocol: "https",
        hostname: "www.pokemon-card.com",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
    ],
  },
};

export default nextConfig;
