import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingIncludes: {
    "/*": [
      "./data/pokemon-names.sqlite",
      "./data/pokemon-sets.sqlite",
      "./data/pokemon-sets-seed.json",
    ],
    "/api/search-sets": ["./data/pokemon-sets.sqlite", "./data/pokemon-sets-seed.json"],
    "/api/bootstrap": [
      "./data/pokemon-sets.sqlite",
      "./data/pokemon-sets-seed.json",
      "./data/pokemon-names.sqlite",
    ],
    "/search": ["./data/pokemon-sets.sqlite", "./data/pokemon-sets-seed.json"],
  },
  turbopack: {
    root: __dirname,
  },
  images: {
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
