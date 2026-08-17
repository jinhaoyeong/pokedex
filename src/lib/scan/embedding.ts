/**
 * On-device image embeddings via transformers.js (CLIP vision encoder).
 *
 * Runs entirely in the browser (WebGPU when available, WASM otherwise), so
 * there is zero per-scan cost. The model (~tens of MB, quantized) is fetched
 * once from the Hugging Face CDN and cached by the browser for later scans.
 *
 * Every entry point fails soft (returns null / throws caught upstream) so the
 * scanner can fall back to perceptual hashing + OCR if the model can't load.
 */

const MODEL_ID = "Xenova/clip-vit-base-patch32";

export type ModelProgress = {
  status: string;
  progress?: number;
  file?: string;
};

type Embedder = {
  embed: (input: string) => Promise<Float32Array | null>;
};

let embedderPromise: Promise<Embedder> | null = null;

async function createEmbedder(
  onProgress?: (progress: ModelProgress) => void,
): Promise<Embedder> {
  const {
    env,
    AutoProcessor,
    CLIPVisionModelWithProjection,
    RawImage,
  } = await import("@huggingface/transformers");

  // Only ever pull from the remote CDN; we ship no local model files.
  env.allowLocalModels = false;

  // Prefer WebGPU for speed, fall back to WASM when unsupported.
  const hasWebGpu =
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
  const device = hasWebGpu ? "webgpu" : "wasm";

  const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
    progress_callback: onProgress,
  });
  // dtype: "q4" (4-bit) — NOT "q8". The q8 vision kernel is numerically
  // unstable for this model: it returns non-deterministic, near-random
  // embeddings for ~15-20% of images (the same photo encoded twice can score
  // below 30% cosine against itself), so a scan would routinely fail to match
  // even the exact catalog art. q4 is deterministic, matches fp32 ranking
  // accuracy in our benchmarks, and is the smallest download (~45 MB).
  const model = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, {
    dtype: "q4",
    device,
    progress_callback: onProgress,
  });

  return {
    async embed(input: string): Promise<Float32Array | null> {
      try {
        const image = await RawImage.read(input);
        const inputs = await processor(image);
        const output = await model(inputs);
        const tensor = output.image_embeds ?? output.pooler_output;
        if (!tensor?.data) {
          return null;
        }
        return l2Normalize(Float32Array.from(tensor.data as ArrayLike<number>));
      } catch {
        return null;
      }
    },
  };
}

/** Load (or reuse) the embedding model. Subsequent calls share one instance. */
export function getEmbedder(
  onProgress?: (progress: ModelProgress) => void,
): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = createEmbedder(onProgress).catch((error) => {
      // Allow a later retry if loading failed.
      embedderPromise = null;
      throw error;
    });
  }
  return embedderPromise;
}

/** Embed an image URL (data URL or http URL). Returns null on any failure. */
export async function embedImage(
  input: string,
  onProgress?: (progress: ModelProgress) => void,
): Promise<Float32Array | null> {
  try {
    const embedder = await getEmbedder(onProgress);
    return await embedder.embed(input);
  } catch {
    return null;
  }
}

/** In-place L2 normalization so similarity reduces to a dot product. */
function l2Normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < vector.length; i += 1) {
    sum += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vector.length; i += 1) {
    vector[i] /= norm;
  }
  return vector;
}

/** Cosine similarity of two L2-normalized vectors (i.e. their dot product). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}
