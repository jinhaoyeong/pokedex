import { DesignComparisonDock } from "@/components/design-comparison-dock";

const changes = [
  "Search and scan now start from the hero.",
  "Market previews explain freshness and confidence.",
  "The card reel has an explicit motion control.",
  "Collector terminology is clearer on first use.",
  "The closing action starts a binder instead of repeating the hero.",
] as const;

export function HomeComparisonDock() {
  return (
    <DesignComparisonDock surface="Homepage" changes={changes} />
  );
}
