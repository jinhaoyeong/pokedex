"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ClientPrice } from "@/components/client-price";
import { formatCardDisplayName } from "@/lib/card-display-name";
import { stashCardForNavigation } from "@/lib/client-catalog-cache";
import { getHeadlineMarketPriceUsd } from "@/lib/localized-set-market";
import { buildLiveSearchApiParams } from "@/lib/search-href";
import { buildScanQuery, parseOcrText } from "@/lib/scan/ocr";
import type { ScanCardGuess, ScanResponse } from "@/lib/scan/types";
import type { LiveSearchResponse, SearchResult } from "@/types/pokemon";

type Stage = "capture" | "camera" | "processing" | "results";

/** Confidence above which we trust OCR and skip the vision fallback. */
const OCR_TRUST_THRESHOLD = 0.55;

/** Downscale an image data URL to keep OCR fast and vision payloads small. */
function downscaleImage(
  source: string,
  maxDimension: number,
  quality: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(source);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Could not load image"));
    img.src = source;
  });
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
 * Validate OCR name candidates against the Pokemon name database. Returns the
 * canonical name of the first candidate the catalog recognizes.
 */
async function confirmName(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates.slice(0, 5)) {
    try {
      const response = await fetch(
        `/api/pokemon-names?q=${encodeURIComponent(candidate)}&limit=5`,
      );
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as {
        results?: Array<{ name: string; englishName: string }>;
      };
      const lower = candidate.toLowerCase();
      const hit = payload.results?.find((item) => {
        const name = item.name?.toLowerCase() ?? "";
        const english = item.englishName?.toLowerCase() ?? "";
        return (
          name === lower ||
          english === lower ||
          name.startsWith(lower) ||
          english.startsWith(lower) ||
          lower.startsWith(english)
        );
      });
      if (hit) {
        return hit.englishName || hit.name;
      }
    } catch {
      // Ignore and try the next candidate.
    }
  }
  return null;
}

export function ScanButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("capture");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [guess, setGuess] = useState<ScanCardGuess | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setResults([]);
    setNotice(null);
    setCameraError(null);
  }, []);

  const closeOverlay = useCallback(() => {
    stopCamera();
    setOpen(false);
    resetState();
  }, [resetState, stopCamera]);

  // Cleanup camera on unmount.
  useEffect(() => stopCamera, [stopCamera]);

  // Close on Escape.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeOverlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOverlay]);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      // No live camera — fall back to the OS capture picker.
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
      // Attach after the video element renders.
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
          setProgress(Math.round(message.progress * 100));
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

  const processImage = useCallback(
    async (sourceDataUrl: string) => {
      stopCamera();
      setStage("processing");
      setProgress(0);
      setNotice(null);
      setResults([]);
      setGuess(null);

      try {
        const [ocrImage, visionImage] = await Promise.all([
          downscaleImage(sourceDataUrl, 1200, 0.85),
          downscaleImage(sourceDataUrl, 840, 0.7),
        ]);
        setPreview(visionImage);

        setStatusText("Reading the card…");
        const text = await runOcr(ocrImage);
        const parsed = parseOcrText(text);

        setStatusText("Matching to the catalog…");
        const confirmedName = await confirmName(parsed.nameCandidates);

        // OCR-first: if we confidently recognized a name, search directly
        // without uploading the photo anywhere.
        if (confirmedName) {
          const ocrGuess: ScanCardGuess = {
            name: confirmedName,
            number: parsed.number,
            suffix: parsed.suffix,
            confidence: parsed.number ? 0.85 : 0.6,
            source: "ocr",
          };
          if (ocrGuess.confidence >= OCR_TRUST_THRESHOLD) {
            const query = buildScanQuery(ocrGuess);
            const params = buildLiveSearchApiParams({ query, page: 1 });
            const response = await fetch(`/api/live-search?${params.toString()}`);
            if (response.ok) {
              const data = (await response.json()) as LiveSearchResponse;
              setGuess(ocrGuess);
              setResults(data.results.slice(0, 12));
              setNotice(
                data.results.length
                  ? null
                  : `Detected "${query}" but found no catalog match. Try refining the search.`,
              );
              setStage("results");
              return;
            }
          }
        }

        // Low-confidence path: let the server try vision (if configured) and
        // fall back to an OCR-text search otherwise.
        setStatusText("Identifying with AI vision…");
        const scanResponse = await fetch("/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: visionImage, ocrText: text }),
        });

        if (!scanResponse.ok) {
          throw new Error("Scan request failed");
        }

        const scan = (await scanResponse.json()) as ScanResponse;
        setGuess(scan.guess);
        setResults(scan.results);
        setNotice(
          scan.notice ??
            (scan.results.length
              ? null
              : "Couldn't match this card. Try a sharper photo or search by name."),
        );
        setStage("results");
      } catch {
        setNotice("Something went wrong while scanning. Please try again.");
        setStage("results");
      }
    },
    [runOcr, stopCamera],
  );

  const capturePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.drawImage(video, 0, 0);
    void processImage(canvas.toDataURL("image/jpeg", 0.92));
  }, [processImage]);

  const onFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) {
        return;
      }
      const dataUrl = await fileToDataUrl(file);
      void processImage(dataUrl);
    },
    [processImage],
  );

  const detectedLabel = guess
    ? buildScanQuery(guess) || guess.name
    : null;

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
        // `capture` hints mobile browsers to open the rear camera directly.
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
            if (event.target === event.currentTarget) {
              closeOverlay();
            }
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
                    the card and pull up matching results with live pricing.
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
                    Tip: fill the frame with the card, avoid glare, and keep the
                    name and number readable for the best match.
                  </p>
                </div>
              ) : null}

              {stage === "camera" ? (
                <div className="space-y-4">
                  <div className="relative overflow-hidden rounded-2xl border border-yellow-200/20 bg-black">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      className="h-auto w-full"
                    />
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
                        Detected · {guess?.source === "vision" ? "AI vision" : "OCR"}
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

                  {results.length ? (
                    <div className="space-y-3">
                      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                        {results.length} match{results.length === 1 ? "" : "es"}
                      </p>
                      {results.map((result, index) => {
                        const title = formatCardDisplayName(result.card);
                        const price = getHeadlineMarketPriceUsd(result.card);
                        return (
                          <Link
                            key={`${result.card.slug}__${index}`}
                            href={`/cards/${result.card.slug}`}
                            prefetch
                            onClick={() => {
                              stashCardForNavigation(result.card);
                              closeOverlay();
                            }}
                            className="glass-card grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 rounded-2xl p-3 transition hover:border-yellow-200/45"
                          >
                            <div className="relative aspect-[0.716/1] w-14 shrink-0 overflow-hidden rounded-xl border border-yellow-200/20 bg-slate-950/50">
                              <Image
                                src={result.card.image}
                                alt={title}
                                fill
                                sizes="56px"
                                className="object-contain"
                              />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-white">
                                {title}
                              </p>
                              <p className="truncate text-xs text-slate-400">
                                {result.card.setName} · #{result.card.collectorNumber}
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
