"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

import {
  hasBootSessionReady,
  markBootSessionReady,
  warmBootHotSearchByLanguage,
  warmBootPreviewCards,
  warmBootSetsByLanguage,
  warmClientCardCacheFromApi,
} from "@/lib/client-catalog-cache";
import type { CardLanguageFilter, LiveSearchResponse, TcgCard, TcgSet } from "@/types/pokemon";

const MIN_LOAD_MS = 450;
const MAX_LOAD_MS = 5_000;
const OPEN_ANIMATION_MS = 1_380;

type BootPhase = "loading" | "opening" | "done";

type SparkStyle = CSSProperties & {
  "--a": string;
  "--d": string;
  "--s": string;
  "--c": string;
  "--t": string;
};

const BOOT_SPARKS = [
  { angle: "-150deg", distance: "5.4rem", size: "3px", color: "#ffffff", delay: "0ms" },
  { angle: "-118deg", distance: "6.2rem", size: "4px", color: "#ffcb05", delay: "28ms" },
  { angle: "-82deg", distance: "5.9rem", size: "3px", color: "#fff4c2", delay: "8ms" },
  { angle: "-42deg", distance: "6.8rem", size: "5px", color: "#ffffff", delay: "42ms" },
  { angle: "-8deg", distance: "5.6rem", size: "3px", color: "#ff9f1c", delay: "18ms" },
  { angle: "30deg", distance: "6.4rem", size: "4px", color: "#ffffff", delay: "62ms" },
  { angle: "70deg", distance: "5.8rem", size: "3px", color: "#ffcb05", delay: "35ms" },
  { angle: "108deg", distance: "6.7rem", size: "4px", color: "#fff4c2", delay: "74ms" },
  { angle: "146deg", distance: "5.5rem", size: "3px", color: "#ffffff", delay: "20ms" },
] as const;

type BootstrapPayload = {
  setsByLanguage?: Partial<Record<CardLanguageFilter, TcgSet[]>>;
  previewCards?: TcgCard[];
  hotSearchByLanguage?: Partial<Record<CardLanguageFilter, LiveSearchResponse>>;
  cardSlugs?: string[];
  stats?: {
    setCount?: number;
    previewCount?: number;
    hotCardCount?: number;
    loadMs?: number;
  };
};

async function loadBootstrap(signal: AbortSignal) {
  const response = await fetch("/api/bootstrap", { signal });

  if (!response.ok) {
    throw new Error("Bootstrap request failed");
  }

  return (await response.json()) as BootstrapPayload;
}

function preloadImages(urls: string[]) {
  return Promise.allSettled(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const image = new window.Image();
          image.decoding = "async";
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = url;
        }),
    ),
  );
}

function subscribeBootSession(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("pokedex-boot-complete", onStoreChange);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("pokedex-boot-complete", onStoreChange);
  };
}

export function AppBootSplash() {
  const router = useRouter();
  const bootSkipped = useSyncExternalStore(
    subscribeBootSession,
    hasBootSessionReady,
    () => false,
  );
  const [phase, setPhase] = useState<BootPhase>("loading");
  const [statusText, setStatusText] = useState("Summoning your card dex...");
  const [progress, setProgress] = useState(8);
  const progressRef = useRef(8);

  const bumpProgress = (next: number) => {
    progressRef.current = Math.max(progressRef.current, Math.min(100, next));
    setProgress(progressRef.current);
  };

  useEffect(() => {
    if (bootSkipped) {
      document.documentElement.classList.add("app-ready");
      return;
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    let cancelled = false;
    let opened = false;

    const creepTimer = window.setInterval(() => {
      if (progressRef.current < 72) {
        bumpProgress(progressRef.current + 2);
      }
    }, 140);

    const beginOpen = () => {
      if (opened || cancelled) {
        return;
      }

      opened = true;
      window.clearInterval(creepTimer);
      bumpProgress(100);
      setStatusText("Gotcha!");
      setPhase("opening");

      window.setTimeout(() => {
        markBootSessionReady();
        document.documentElement.classList.add("app-ready");
        window.dispatchEvent(new Event("pokedex-boot-complete"));
        setPhase("done");
      }, OPEN_ANIMATION_MS);
    };

    const scheduleOpen = () => {
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, MIN_LOAD_MS - elapsed);
      window.setTimeout(beginOpen, remaining);
    };

    router.prefetch("/");
    router.prefetch("/search");
    router.prefetch("/portfolio");
    router.prefetch("/settings");
    router.prefetch("/search?sort=price-desc");
    router.prefetch("/search?lang=en&sort=price-desc");
    router.prefetch("/search?lang=ja&sort=price-desc");
    router.prefetch("/search?lang=zh-cn&sort=price-desc");
    router.prefetch("/search?lang=zh-tw&sort=price-desc");

    const loadTask = (async () => {
      try {
        setStatusText("Syncing sets and market picks...");
        bumpProgress(24);

        const payload = await loadBootstrap(controller.signal);
        bumpProgress(58);

        if (payload.setsByLanguage) {
          warmBootSetsByLanguage(payload.setsByLanguage);
        }

        if (payload.previewCards?.length) {
          warmBootPreviewCards(payload.previewCards);
        }

        if (payload.hotSearchByLanguage) {
          warmBootHotSearchByLanguage(payload.hotSearchByLanguage);
        }

        bumpProgress(76);
        setStatusText("Caching card art and detail pages...");

        const imageUrls = [
          ...(payload.previewCards ?? []).map((card) => card.image),
          ...Object.values(payload.hotSearchByLanguage ?? {})
            .flatMap((response) => response?.results ?? [])
            .map((result) => result.card.image),
        ]
          .filter((url) => Boolean(url) && url !== "/icon.svg")
          .slice(0, 16);

        const slugs = payload.cardSlugs ?? payload.previewCards?.map((card) => card.slug) ?? [];

        const saveData =
          typeof navigator !== "undefined" &&
          "connection" in navigator &&
          (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
        const warmSlugs = saveData ? slugs.slice(0, 4) : slugs.slice(0, 12);

        await Promise.allSettled(
          warmSlugs.map(async (slug) => {
            if (!saveData) {
              await warmClientCardCacheFromApi(slug, controller.signal);
            }

            router.prefetch(`/cards/${slug}`);
          }),
        );

        const searchWarmupRoutes = [
          "/search",
          "/search?sort=price-desc",
          "/search?lang=en&sort=price-desc",
          "/search?lang=ja&sort=price-desc",
          "/search?lang=zh-cn&sort=price-desc",
          "/search?lang=zh-tw&sort=price-desc",
        ];

        for (const href of searchWarmupRoutes) {
          router.prefetch(href);
        }

        await Promise.race([
          preloadImages(imageUrls),
          new Promise<void>((resolve) => {
            window.setTimeout(resolve, 900);
          }),
        ]);

        bumpProgress(94);

        const setCount = payload.stats?.setCount ?? payload.setsByLanguage?.all?.length ?? 0;
        const hotCount = payload.stats?.hotCardCount ?? 0;
        setStatusText(
          setCount > 0
            ? `Ready — ${setCount.toLocaleString()} sets, ${hotCount.toLocaleString()} hot cards`
            : "Trainer gear loaded",
        );
        bumpProgress(100);
      } catch {
        setStatusText("Starting with offline catalog...");
        bumpProgress(100);
      }
    })();

    const deadlineTimer = window.setTimeout(() => {
      scheduleOpen();
    }, MAX_LOAD_MS);

    void loadTask.finally(() => {
      window.clearTimeout(deadlineTimer);
      scheduleOpen();
    });

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(creepTimer);
      window.clearTimeout(deadlineTimer);
    };
  }, [bootSkipped, router]);

  if (bootSkipped || phase === "done") {
    return null;
  }

  return (
    <div
      className={`app-boot-splash app-boot-splash--${phase}`}
      role="status"
      aria-live="polite"
      aria-busy={phase === "loading"}
    >
      <div className="app-boot-splash__backdrop" />
      <div className="app-boot-splash__sparkles" aria-hidden="true" />
      <div className="app-boot-splash__panel">
        <div
          className={[
            "app-boot-pokeball",
            phase === "loading" ? "app-boot-pokeball--loading" : "",
            phase === "opening" ? "app-boot-pokeball--open" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        >
          <span className="app-boot-pokeball__halo" />
          <span className="app-boot-pokeball__rays" />
          <span className="app-boot-pokeball__beam" />
          <span className="app-boot-pokeball__flash" />
          <span className="app-boot-pokeball__shock" />
          <span className="app-boot-pokeball__shock app-boot-pokeball__shock--2" />
          <span className="app-boot-pokeball__sparks">
            {BOOT_SPARKS.map((spark, index) => (
              <i
                key={`${spark.angle}-${index}`}
                style={
                  {
                    "--a": spark.angle,
                    "--d": spark.distance,
                    "--s": spark.size,
                    "--c": spark.color,
                    "--t": spark.delay,
                  } as SparkStyle
                }
              />
            ))}
          </span>
          <div className="app-boot-pokeball__shell">
            <div className="app-boot-pokeball__lid">
              <span className="app-boot-pokeball__lid-face">
                <span className="app-boot-pokeball__shine" />
              </span>
              {/* Painted underside so the open clamshell stays intentional, not a dark void. */}
              <span className="app-boot-pokeball__lid-inner" aria-hidden="true" />
              <span className="app-boot-pokeball__lid-rim" />
              {/* Button rides with the lid so the open state stays one piece. */}
              <div className="app-boot-pokeball__button">
                <span className="app-boot-pokeball__button-glow" />
                <span className="app-boot-pokeball__button-outer" />
                <span className="app-boot-pokeball__button-inner" />
              </div>
            </div>
            <div className="app-boot-pokeball__bowl">
              <span className="app-boot-pokeball__bowl-well" />
              <span className="app-boot-pokeball__bowl-rim" />
            </div>
            <span className="app-boot-pokeball__cavity" aria-hidden="true" />
            <span className="app-boot-pokeball__core" />
            <span className="app-boot-pokeball__seam" />
            <span className="app-boot-pokeball__crack" />
          </div>
        </div>

        <p className="app-boot-splash__brand pokemon-display-title">PokePokedex</p>
        <p className="app-boot-splash__status">{statusText}</p>

        <div
          className="app-boot-splash__progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span
            className="app-boot-splash__progress-bar"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
