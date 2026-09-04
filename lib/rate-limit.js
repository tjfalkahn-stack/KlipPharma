/**
 * In-process bounded rate limiter with expiry sweep.
 *
 * Multi-instance behavior: this store is per Node process only. Railway (or any
 * multi-replica) deployments do not share counts across instances. Global write
 * quotas need a shared limiter (Redis, edge/WAF, or the platform proxy) in front
 * of the app. This module still bounds memory: expired keys are swept and the
 * map is capped so it cannot grow without limit.
 */

const DEFAULT_MAX_KEYS = 10_000;

export function createBoundedRateLimiter({
  windowMs = 10 * 60 * 1000,
  max = 80,
  maxKeys = DEFAULT_MAX_KEYS,
  message = "Too many requests. Try again in a few minutes.",
} = {}) {
  const hits = new Map();
  let sweepTimer = null;

  function sweep(now = Date.now()) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
    if (hits.size <= maxKeys) return;
    const overflow = hits.size - maxKeys;
    let removed = 0;
    for (const key of hits.keys()) {
      hits.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  function middleware(req, res, next) {
    const now = Date.now();
    if (hits.size > maxKeys * 0.9) sweep(now);
    const key = `${req.ip}:${req.user?.id || "anon"}:${req.method}:${req.baseUrl || ""}${req.path}`;
    let attempt = hits.get(key);
    if (!attempt || attempt.resetAt <= now) {
      attempt = { count: 0, resetAt: now + windowMs };
    }
    attempt.count += 1;
    hits.set(key, attempt);
    if (attempt.count > max) {
      return res.status(429).json({ error: message });
    }
    return next();
  }

  middleware.size = () => hits.size;
  middleware.sweep = sweep;
  middleware.reset = () => hits.clear();
  middleware.startSweeper = (intervalMs = Math.min(windowMs, 60_000)) => {
    if (sweepTimer) return middleware;
    sweepTimer = setInterval(() => sweep(), intervalMs);
    if (sweepTimer && typeof sweepTimer === "object" && "unref" in sweepTimer) {
      sweepTimer.unref();
    }
    return middleware;
  };
  middleware.stopSweeper = () => {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
  };
  return middleware;
}

export function writeMethodsOnly(limiter) {
  const writes = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  return function writeLimiter(req, res, next) {
    if (!writes.has(req.method)) return next();
    return limiter(req, res, next);
  };
}
