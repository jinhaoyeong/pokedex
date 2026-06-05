import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
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
    ],
  },
};

export default nextConfig;
