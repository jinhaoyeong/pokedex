import "server-only";

type HostCircuitState = {
  failures: number;
  openUntil: number;
};

type HostGovernorRuntime = {
  circuits: Map<string, HostCircuitState>;
  lastRequestAt: Map<string, number>;
  queues: Map<string, Promise<void>>;
};

type RunHostRequestOptions = {
  minIntervalMs: number;
  jitterMs?: number;
  signal?: AbortSignal;
  circuitMessage?: string;
};

type RecordHostFailureOptions = {
  threshold: number;
  cooldownMs: number;
  openImmediately?: boolean;
};

const globalRuntime = globalThis as typeof globalThis & {
  __pokedexHostGovernorRuntime?: HostGovernorRuntime;
};

const runtime =
  globalRuntime.__pokedexHostGovernorRuntime ??
  (globalRuntime.__pokedexHostGovernorRuntime = {
    circuits: new Map(),
    lastRequestAt: new Map(),
    queues: new Map(),
  });

function normalizeHost(host: string) {
  return host.trim().toLowerCase();
}

function wait(ms: number, signal?: AbortSignal) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Request aborted"));
      },
      { once: true },
    );
  });
}

export function isHostCircuitOpen(host: string) {
  const state = runtime.circuits.get(normalizeHost(host));
  return Boolean(state && state.openUntil > Date.now());
}

export function recordHostSuccess(host: string) {
  const key = normalizeHost(host);
  const state = runtime.circuits.get(key);

  // A success may finish after another request opened a cooldown. Never let
  // stale success erase an active circuit.
  if (!state || state.openUntil <= Date.now()) {
    runtime.circuits.delete(key);
  }
}

export function recordHostFailure(host: string, options: RecordHostFailureOptions) {
  const key = normalizeHost(host);
  if (!key) {
    return;
  }

  const state = runtime.circuits.get(key) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;

  if (options.openImmediately || state.failures >= Math.max(1, options.threshold)) {
    state.openUntil = Date.now() + Math.max(1, options.cooldownMs);
  }

  runtime.circuits.set(key, state);
}

/**
 * One shared per-host semaphore for every market transport. After cooldown,
 * queued callers resume one at a time, making the first request the half-open
 * probe. If it fails and reopens the circuit, all remaining callers skip.
 */
export async function runGovernedHostRequest<T>(
  host: string,
  options: RunHostRequestOptions,
  task: () => Promise<T>,
): Promise<T> {
  const key = normalizeHost(host);
  if (!key) {
    return task();
  }

  const previous = runtime.queues.get(key) ?? Promise.resolve();
  let releaseSlot: () => void = () => undefined;
  const slot = new Promise<void>((resolve) => {
    releaseSlot = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => slot);
  runtime.queues.set(key, queued);

  await previous.catch(() => undefined);

  try {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error("Request aborted");
    }

    const elapsed = Date.now() - (runtime.lastRequestAt.get(key) ?? 0);
    const jitter =
      (options.jitterMs ?? 0) > 0 ? Math.floor(Math.random() * (options.jitterMs ?? 0)) : 0;
    await wait(Math.max(0, options.minIntervalMs + jitter - elapsed), options.signal);

    if (isHostCircuitOpen(key)) {
      throw new Error(
        options.circuitMessage ??
          `Skipping ${key}: source circuit open after repeated failures`,
      );
    }

    runtime.lastRequestAt.set(key, Date.now());
    return await task();
  } finally {
    releaseSlot();
    if (runtime.queues.get(key) === queued) {
      runtime.queues.delete(key);
    }
  }
}
