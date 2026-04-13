/**
 * In-memory IP-based rate limiter.
 *
 * Limits: 10 requests/minute, 50 requests/day per IP.
 * Note: Resets on serverless cold starts. Sufficient for moderate protection.
 */

const rateLimitMap = new Map();

const MINUTE_LIMIT = 10;
const DAILY_LIMIT = 50;
const MINUTE_WINDOW = 60 * 1000;
const DAY_WINDOW = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL = 10 * 60 * 1000;

// Periodic cleanup of stale entries (runs while function instance is warm)
let cleanupTimer = null;
function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitMap) {
      if (now - data.lastRequest > DAY_WINDOW) {
        rateLimitMap.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL);
  // Don't let the timer prevent process exit
  if (cleanupTimer.unref) cleanupTimer.unref();
}

/**
 * Check if an IP address is within rate limits.
 * @param {string} ip - Client IP address
 * @returns {{ allowed: boolean, retryAfter: number, dailyRemaining: number }}
 */
function checkRateLimit(ip) {
  ensureCleanup();
  const now = Date.now();

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, {
      timestamps: [now],
      dailyCount: 1,
      dayStart: now,
      lastRequest: now,
    });
    return { allowed: true, retryAfter: 0, dailyRemaining: DAILY_LIMIT - 1 };
  }

  const data = rateLimitMap.get(ip);
  data.lastRequest = now;

  // Reset daily counter if 24 hours have passed
  if (now - data.dayStart > DAY_WINDOW) {
    data.dailyCount = 0;
    data.dayStart = now;
  }

  // Check daily limit
  if (data.dailyCount >= DAILY_LIMIT) {
    const retryAfter = Math.ceil((data.dayStart + DAY_WINDOW - now) / 1000);
    return { allowed: false, retryAfter, dailyRemaining: 0 };
  }

  // Remove timestamps older than 1 minute
  data.timestamps = data.timestamps.filter((t) => now - t < MINUTE_WINDOW);

  // Check per-minute limit
  if (data.timestamps.length >= MINUTE_LIMIT) {
    const oldest = Math.min(...data.timestamps);
    const retryAfter = Math.ceil((oldest + MINUTE_WINDOW - now) / 1000);
    return {
      allowed: false,
      retryAfter,
      dailyRemaining: DAILY_LIMIT - data.dailyCount,
    };
  }

  // Allow request
  data.timestamps.push(now);
  data.dailyCount++;

  return {
    allowed: true,
    retryAfter: 0,
    dailyRemaining: DAILY_LIMIT - data.dailyCount,
  };
}

module.exports = { checkRateLimit };
