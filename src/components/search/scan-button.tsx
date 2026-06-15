"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { formatCardDisplayName } from "@/lib/card-display-name";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { cosineSimilarity } from "@/lib/scan/embedding";
import { recallScans, rememberScan } from "@/lib/scan/embedding-store";
import {
  buildScanQuery,
  fuzzyNameScore,
  parseOcrText,
} from "@/lib/scan/ocr";
import { hashSimilarity } from "@/lib/scan/phash";
import {
  buildPhotoSignature,
  rankByVisualSimilarity,
  type PhotoSignature,
} from "@/lib/scan/scan-matcher";
import type { ScanCardGuess, ScanMatch } from "@/lib/scan/types";
import { buildLiveSearchApiParams } from "@/lib/search-href";
import type { LiveSearchResponse, SearchResult } from "@/types/pokemon";

type Stage = "capture" | "camera" | "processing" | "results";

/** Use the on-device neural recognizer (falls back to perceptual hash). */
const NEURAL_ENABLED = true;
/** Name-DB fuzzy match above this is trusted despite OCR noise. */
const NAME_MATCH_THRESHOLD = 0.72;
/** A remembered scan above this similarity is treated as the same card. */
const MEMORY_NEURAL_THRESHOLD = 0.9;
const MEMORY_HASH_THRESHOLD = 0.92;

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = src;
  });
}

/** Downscale an image data URL to bound OCR/encode cost. */
async function downscaleImage(
  source: string,
  maxDimension: number,
  quality: number,
): Promise<string> {
  const img = await loadImageElement(source);
  const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Grayscale + contrast-stretch an image to improve OCR legibility. */
async function preprocessForOcr(source: string): Promise<string> {
  const img = await loadImageElement(source);
  const scale = Math.min(1, 1400 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return source;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const boosted = Math.max(0, Math.min(255, (gray - 128) * 1.4 + 128));
    data[i] = boosted;
    data[i + 1] = boosted;
    data[i + 2] = boosted;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.9);
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Resolve OCR name candidates to a canonical catalog name using the Pokemon
 * name database plus fuzzy scoring (tolerant of OCR character swaps).
 */
async function confirmName(
  candidates: string[],
): Promise<{ name: string; score: number } | null> {
  let best: { name: string; score: number } | null = null;
  for (const candidate of candidates.slice(0, 6)) {
    if (candidate.length < 3) continue;
    try {
      const response = await fetch(
        `/api/pokemon-names?q=${encodeURIComponent(candidate)}&limit=8`,
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as {
        results?: Array<{ name: string; englishName: string }>;
      };
      for (const hit of payload.results ?? []) {
        const name = hit.englishName || hit.name;
        const score = Math.max(
          fuzzyNameScore(candidate, hit.name),
          fuzzyNameScore(candidate, hit.englishName),
        );
        if (score > (best?.score ?? 0)) {
          best = { name, score };
        }
      }
    } catch {
      // Try the next candidate.
    }
  }
  return best && best.score >= NAME_MATCH_THRESHOLD ? best : null;
}

async function fetchCardResult(slug: string): Promise<SearchResult | null> {
  try {
    const response = await fetch(`/api/cards/${slug}`);
    if (!response.ok) return null;
    const { card } = (await response.json()) as { card?: SearchResult["card"] };
    return card ? { card, score: 1, matchReason: "Scan memory" } : null;
  } catch {
    return null;
  }
}

function dedupeMatches(matches: ScanMatch[]): ScanMatch[] {
  const seen = new Set<string>();
  const unique: ScanMatch[] = [];
  for (const match of matches) {
    if (seen.has(match.result.card.slug)) continue;
    seen.add(match.result.card.slug);
    unique.push(match);
  }
  return unique;
}

export function ScanButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("capture");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [guess, setGuess] = useState<ScanCardGuess | null>(null);
  const [matches, setMatches] = useState<ScanMatch[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoSignatureRef = useRef<PhotoSignature | null>(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const resetState = useCallback(() => {
    setStage("capture");
    setProgress(0);
    setStatusText("");
    setPreview(null);
    setGuess(null);
    setMatches([]);
    setNotice(null);
    setCameraError(null);
    photoSignatureRef.current = null;
  }, []);

  const closeOverlay = useCallback(() => {
    stopCamera();
    setOpen(false);
    resetState();
  }, [resetState, stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeOverlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOverlay]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setStage("camera");
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
      });
    } catch {
      setCameraError(
        "Camera unavailable. Upload a photo instead, or check camera permissions.",
      );
    }
  }, []);

  const runOcr = useCallback(async (ocrImage: string): Promise<string> => {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      logger: (message: { status: string; progress: number }) => {
        if (message.status === "recognizing text") {
          setProgress(Math.round(message.progress * 60));
        }
      },
    });
    try {
      const { data } = await worker.recognize(ocrImage);
      return data.text ?? "";
    } finally {
      await worker.terminate();
    }
  }, []);

  /** Compare a photo signature against remembered (confirmed) scans. */
  const recallBestMemory = useCallback(async (signature: PhotoSignature) => {
    const memories = await recallScans();
    let best: { slug: string; score: number } | null = null;
    for (const memory of memories) {
      let score = 0;
      if (signature.vector && memory.vector) {
        score = cosineSimilarity(signature.vector, memory.vector);
      } else if (memory.hash) {
        score = hashSimilarity(signature.hash, BigInt(memory.hash));
      }
      if (score > (best?.score ?? 0)) {
        best = { slug: memory.slug, score };
      }
    }
    if (!best) return null;
    const strong =
      best.score >= (signature.vector ? MEMORY_NEURAL_THRESHOLD : MEMORY_HASH_THRESHOLD);
    return strong ? best : null;
  }, []);

  const processImage = useCallback(
    async (sourceDataUrl: string) => {
      stopCamera();
      setStage("processing");
      setProgress(0);
      setNotice(null);
      setMatches([]);
      setGuess(null);
      photoSignatureRef.current = null;

      try {
        const [ocrImage, encodeImage] = await Promise.all([
          preprocessForOcr(sourceDataUrl),
          downscaleImage(sourceDataUrl, 640, 0.9),
        ]);
        setPreview(encodeImage);

        // 1) Read the card text.
        setStatusText("Reading the card…");
        const text = await runOcr(ocrImage);
        const parsed = parseOcrText(text);

        // 2) Resolve the name against the catalog (fuzzy / OCR-tolerant).
        setStatusText("Matching to the catalog…");
        setProgress(65);
        const confirmed = await confirmName(parsed.nameCandidates);
        const detectedGuess: ScanCardGuess | null = confirmed
          ? {
              name: confirmed.name,
              number: parsed.number,
              suffix: parsed.suffix,
              confidence: parsed.number ? 0.85 : 0.6,
              source: "ocr",
            }
          : parsed.nameCandidates[0]
            ? {
                name: parsed.nameCandidates[0],
                number: parsed.number,
                suffix: parsed.suffix,
                confidence: 0.3,
                source: "ocr",
              }
            : null;
        setGuess(detectedGuess);

        // 3) Pull candidate cards from the live catalog.
        let candidates: SearchResult[] = [];
        const query = detectedGuess ? buildScanQuery(detectedGuess) : "";
        if (query) {
          const params = buildLiveSearchApiParams({ query, page: 1 });
          const response = await fetch(`/api/live-search?${params.toString()}`);
          if (response.ok) {
            const data = (await response.json()) as LiveSearchResponse;
            candidates = data.results.slice(0, 18);
          }
        }

        // 4) Build the photo signature (perceptual hash + neural embedding).
        setStatusText(
          NEURAL_ENABLED ? "Loading recognizer (first scan only)…" : "Analyzing artwork…",
        );
        const photoEl = await loadImageElement(encodeImage);
        const signature = await buildPhotoSignature(
          photoEl,
          encodeImage,
          NEURAL_ENABLED,
          (modelProgress) => {
            if (modelProgress.status === "progress" && modelProgress.progress) {
              setProgress(65 + Math.round((modelProgress.progress / 100) * 15));
            }
          },
        );
        photoSignatureRef.current = signature;

        // 5) Visually re-rank candidates against the photo.
        setStatusText("Comparing artwork…");
        let ranked = await rankByVisualSimilarity(signature, candidates, {
          neural: NEURAL_ENABLED && Boolean(signature.vector),
          onProgress: (done, total) => {
            setProgress(80 + Math.round((done / Math.max(1, total)) * 18));
          },
        });

        // 6) Fast-path: a previously confirmed scan of this exact card.
        const memory = await recallBestMemory(signature);
        if (memory && !ranked.some((m) => m.result.card.slug === memory.slug)) {
          const remembered = await fetchCardResult(memory.slug);
          if (remembered) {
            ranked = dedupeMatches([
              { result: remembered, visualScore: memory.score, method: "neural" },
              ...ranked,
            ]);
          }
        } else if (memory) {
          // Boost the remembered card to the top.
          ranked = dedupeMatches(
            [...ranked].sort((a, b) => {
              if (a.result.card.slug === memory.slug) return -1;
              if (b.result.card.slug === memory.slug) return 1;
              return 0;
            }),
          );
        }

        setProgress(100);
        setMatches(ranked.slice(0, 12));
        setNotice(
          ranked.length
            ? null
            : "Couldn't match this card. Try a sharper, well-lit photo of the full card, or search by name.",
        );
        setStage("results");
      } catch {
        setNotice("Something went wrong while scanning. Please try again.");
        setStage("results");
      }
    },
    [recallBestMemory, runOcr, stopCamera],
  );

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    void processImage(canvas.toDataURL("image/jpeg", 0.92));
  }, [processImage]);

  const onFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      void processImage(dataUrl);
    },
    [processImage],
  );

  /** Persist a confirmed photo → card mapping so future scans improve. */
  const confirmMatch = useCallback((match: ScanMatch) => {
    const signature = photoSignatureRef.current;
    if (signature) {
      // Remember the photo's signature → the card the user confirmed. The
      // card's own art signature is cached separately during ranking, so we
      // never overwrite it with a photo embedding here.
      void rememberScan({
        cardId: match.result.card.id,
        slug: match.result.card.slug,
        name: match.result.card.name,
        vector: signature.vector ?? undefined,
        hash: signature.hash.toString(),
        addedAt: Date.now(),
      });
    }
    stashCardForNavigation(match.result.card);
  }, []);

  const detectedLabel = guess ? buildScanQuery(guess) || guess.name : null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          resetState();
        }}
        className="scan-trigger inline-flex items-center justify-center gap-2 rounded-2xl border border-yellow-200/30 bg-[#0b1730] px-4 py-2.5 text-sm font-black text-yellow-100 transition hover:-translate-y-0.5 hover:border-yellow-200/60"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
          className="h-4 w-4"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"
          />
          <circle cx="12" cy="12" r="3.25" />
        </svg>
        Scan a card
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFileChange}
      />

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Scan a Pokemon card"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeOverlay();
          }}
        >
          <div className="glass-card scan-modal flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-yellow-200/25 bg-[#070d1f]/95 sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-yellow-200/15 px-5 py-4">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-200/80">
                  Card Dex scanner
                </p>
                <h2 className="text-lg font-black text-white">Scan a card</h2>
              </div>
              <button
                type="button"
                onClick={closeOverlay}
                aria-label="Close scanner"
                className="rounded-full border border-yellow-200/20 px-3 py-1 text-sm font-bold text-slate-300 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              {stage === "capture" ? (
                <div className="space-y-5">
                  <p className="text-sm text-slate-300">
                    Take a photo or upload an image of a Pokémon card. We read
                    the card, recognize the artwork on-device, and pull up the
                    closest matches with live pricing.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={startCamera}
                      className="trainer-button rounded-2xl bg-blue-500 px-5 py-4 text-sm font-black text-white"
                    >
                      Take a photo
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-2xl border border-yellow-200/30 bg-[#0b1730] px-5 py-4 text-sm font-black text-yellow-100 hover:border-yellow-200/60"
                    >
                      Upload a photo
                    </button>
                  </div>
                  {cameraError ? (
                    <p className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
                      {cameraError}
                    </p>
                  ) : null}
                  <p className="text-xs leading-5 text-slate-500">
                    Recognition runs entirely in your browser — your photo is
                    never uploaded. The first scan downloads the recognizer once,
                    then it&apos;s cached for instant scans.
                  </p>
                </div>
              ) : null}

              {stage === "camera" ? (
                <div className="space-y-4">
                  <div className="relative overflow-hidden rounded-2xl border border-yellow-200/20 bg-black">
                    <video ref={videoRef} playsInline muted className="h-auto w-full" />
                    <div className="pointer-events-none absolute inset-6 rounded-2xl border-2 border-yellow-200/50" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={capturePhoto}
                      className="trainer-button rounded-2xl bg-blue-500 px-5 py-4 text-sm font-black text-white"
                    >
                      Capture
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        stopCamera();
                        setStage("capture");
                      }}
                      className="rounded-2xl border border-yellow-200/30 bg-[#0b1730] px-5 py-4 text-sm font-black text-yellow-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {stage === "processing" ? (
                <div className="space-y-5 py-6 text-center">
                  {preview ? (
                    <div className="relative mx-auto aspect-[0.716/1] w-40 overflow-hidden rounded-2xl border border-yellow-200/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preview}
                        alt="Scanned card"
                        className="h-full w-full object-cover"
                      />
                      <span className="scan-laser" aria-hidden="true" />
                    </div>
                  ) : null}
                  <p className="text-sm font-bold text-white">{statusText}</p>
                  <div className="mx-auto h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-yellow-300 transition-all"
                      style={{ width: `${Math.max(8, progress)}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {stage === "results" ? (
                <div className="space-y-4">
                  {detectedLabel ? (
                    <div className="rounded-2xl border border-blue-400/25 bg-blue-400/10 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-200/80">
                        Detected
                      </p>
                      <p className="mt-1 text-lg font-black text-white">
                        {detectedLabel}
                      </p>
                    </div>
                  ) : null}

                  {notice ? (
                    <p className="rounded-2xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm font-bold text-amber-100">
                      {notice}
                    </p>
                  ) : null}

                  {matches.length ? (
                    <div className="space-y-3">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                        Tap the correct card to confirm and improve future scans
                      </p>
                      {matches.map((match, index) => {
                        const card = match.result.card;
                        const title = formatCardDisplayName(card);
                        const price = getHeadlineMarketPriceUsd(card);
                        const percent = Math.round(match.visualScore * 100);
                        return (
                          <Link
                            key={`${card.slug}__${index}`}
                            href={`/cards/${card.slug}`}
                            prefetch
                            onClick={() => {
                              confirmMatch(match);
                              closeOverlay();
                            }}
                            className={`glass-card grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 rounded-2xl p-3 transition hover:border-yellow-200/45 ${
                              index === 0 ? "border-yellow-200/45" : ""
                            }`}
                          >
                            <div className="relative aspect-[0.716/1] w-14 shrink-0 overflow-hidden rounded-xl border border-yellow-200/20 bg-slate-950/50">
                              <Image
                                src={card.image}
                                alt={title}
                                fill
                                sizes="56px"
                                className="object-contain"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-bold text-white">
                                  {title}
                                </p>
                                {match.method !== "none" && percent > 0 ? (
                                  <span
                                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                                      index === 0
                                        ? "bg-yellow-300/20 text-yellow-100"
                                        : "bg-white/10 text-slate-300"
                                    }`}
                                  >
                                    {percent}% {match.method === "neural" ? "AI" : "match"}
                                  </span>
                                ) : null}
                              </div>
                              <p className="truncate text-xs text-slate-400">
                                {card.setName} · #{card.collectorNumber}
                              </p>
                              {price > 0 ? (
                                <ClientPrice
                                  amountUsd={price}
                                  className="text-sm font-bold text-blue-300"
                                />
                              ) : null}
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}

                  <div className="grid gap-3 pt-1 sm:grid-cols-2">
                    {detectedLabel ? (
                      <button
                        type="button"
                        onClick={() => {
                          const params = buildLiveSearchApiParams({
                            query: detectedLabel,
                            page: 1,
                          });
                          closeOverlay();
                          router.push(`/search?${params.toString()}`);
                        }}
                        className="trainer-button rounded-2xl bg-blue-500 px-5 py-3 text-sm font-black text-white"
                      >
                        Refine in search
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={resetState}
                      className="rounded-2xl border border-yellow-200/30 bg-[#0b1730] px-5 py-3 text-sm font-black text-yellow-100 hover:border-yellow-200/60"
                    >
                      Scan another
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
