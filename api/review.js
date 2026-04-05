/**
 * POST /api/review
 * 
 * Vercel serverless function — secure proxy between the browser and Gemini API.
 * Applies rate limiting, input validation, and prompt injection detection.
 */

const { checkRateLimit } = require('../lib/rate-limiter');
const { validateInput } = require('../lib/input-validator');
const { reviewCode } = require('../lib/gemini-client');

module.exports = async function handler(req, res) {
  // ── CORS (allow same-origin, block unknown origins in production) ──────────
  res.setHeader('Content-Type', 'application/json');

  // ── Only POST ──────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── Extract client IP ─────────────────────────────────────────────────────
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown';

  // ── Rate limit check ──────────────────────────────────────────────────────
  const rateResult = checkRateLimit(ip);

  // Always send rate limit headers so the frontend can display remaining
  res.setHeader('X-RateLimit-Daily-Remaining', String(rateResult.dailyRemaining));

  if (!rateResult.allowed) {
    return res.status(429).json({
      error: rateResult.dailyRemaining <= 0
        ? 'Daily review limit reached. Please come back tomorrow!'
        : 'Too many requests. Please wait a moment before trying again.',
      retryAfter: rateResult.retryAfter,
      dailyRemaining: rateResult.dailyRemaining,
    });
  }

  // ── Parse request body ────────────────────────────────────────────────────
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object with "code" and "language" fields.' });
  }

  const { code, language } = body;

  // ── Input validation (injection detection + code confidence) ──────────────
  const validation = validateInput(code, language);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  // ── Call Gemini API ───────────────────────────────────────────────────────
  try {
    const review = await reviewCode(code, language);

    return res.status(200).json({
      success: true,
      review,
      dailyRemaining: rateResult.dailyRemaining,
    });
  } catch (err) {
    console.error('Review error:', err.message);

    // Determine appropriate status code
    const status = err.message.includes('busy') ? 503 : 502;

    return res.status(status).json({
      error: err.message || 'Failed to generate review. Please try again.',
    });
  }
};
