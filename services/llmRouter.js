// LLM Router — tries Groq first, falls back to Gemini
// Returns a response in the same format as groq-sdk's chat.completions.create()

import { createGroqCompletion } from "./groq.js";
import { generateWithGemini } from "./gemini.js";

// Only fall back on transient failures (rate limits, timeouts, network/server errors)
// Do NOT fall back on config errors (missing key, invalid model, bad request, etc.)
function shouldFallback(error) {
  if (!error) return false;
  const code = String(error.code || "").toLowerCase();
  const msg = String(error.message || "").toLowerCase();
  const status = error.status || 0;

  if (code === "timeout" || status === 408) return true;
  if (code.includes("rate_limit") || status === 429) return true;
  if (code === "network_error") return true;
  if (status === 413 && (msg.includes("token") || msg.includes("rate limit") || msg.includes("tpm") || msg.includes("tpd") || code.includes("rate_limit"))) return true;
  if (msg.includes("rate limit") || msg.includes("tokens per minute") || msg.includes("tokens per day") || msg.includes("quota exceeded") || msg.includes("resource_exhausted")) return true;
  if (status === 502) return true;  // bad gateway
  if (status === 503) return true;  // unavailable
  if (status >= 500) return true;   // server error
  return false;
}

/**
 * Try Groq first, fall back to Gemini on failure.
 *
 * @param {Object} opts
 * @param {Array}  opts.messages        - Chat messages array [{role, content}, ...]
 * @param {string} [opts.model]         - Model name
 * @param {number} [opts.temperature]   - Temperature (default: 0.5)
 * @param {Object} [opts.response_format] - e.g. { type: "json_object" }
 * @param {boolean} [opts.disableFallback] - If true, do NOT fall back to Gemini
 * @returns {Promise<Object>} Response in { choices: [{ message: { content } }], ... } format
 */
export async function generateLLMResponse({
  messages,
  model,
  temperature,
  response_format,
  disableFallback = false,
}) {
  const errors = [];
  let usedProvider = null;
  let fallbackReason = null;
  let result = null;

  // ─── Attempt 1: Groq ─────────────────────────────────────────────────
  try {
    const groqResult = await createGroqCompletion({
      messages,
      model: model || process.env.GROQ_MODEL,
      temperature: temperature ?? 0.5,
      response_format: response_format || { type: "json_object" },
    });
    usedProvider = "groq";
    result = groqResult;
  } catch (groqError) {
    errors.push({ provider: "groq", error: groqError });

    // Check if we should fall back
    if (disableFallback || !shouldFallback(groqError)) {
      throw enhanceError(groqError, "groq");
    }

    fallbackReason = `${groqError.code || `HTTP_${groqError.status}`}${groqError.message ? ` — ${groqError.message}` : ""}`;

    console.warn(
      `[LLM Router] Groq failed (${groqError.code || groqError.status}), falling back to Gemini.`
    );
  }

  // ─── Attempt 2: Gemini (fallback) ────────────────────────────────────
  if (!result) {
    try {
      const geminiResult = await generateWithGemini({
        messages,
        model: model?.startsWith("gemini") ? model : "gemini-3.5-flash-lite",
        temperature: temperature ?? 0.5,
        response_format: response_format || { type: "json_object" },
      });
      usedProvider = "gemini";
      result = geminiResult;
    } catch (geminiError) {
      errors.push({ provider: "gemini", error: geminiError });

      // Both providers failed — throw the combined error
      throw createCombinedError(errors);
    }
  }

  // Attach provider metadata
  if (result) {
    result._provider = usedProvider;
    if (fallbackReason) {
      result._fallbackReason = fallbackReason;
    }
  }

  return result;
}

// ─── Error helpers ───────────────────────────────────────────────────────

function enhanceError(error, provider) {
  const msg = `[${provider}] ${error.message}`;
  const enhanced = new Error(msg);
  enhanced.code = error.code || `${provider.toUpperCase()}_ERROR`;
  enhanced.status = error.status || 500;
  enhanced.provider = provider;
  return enhanced;
}

function createCombinedError(errors) {
  const details = errors
    .map((e) => `${e.provider}: ${e.error.message}`)
    .join(" | ");
  const hasDailyQuota = errors.some(
    (e) =>
      e.error?.code === "DAILY_QUOTA_EXHAUSTED" ||
      /tokens per day|requests per day|daily quota|perday/i.test(e.error?.message || "")
  );
  const combined = new Error(`LLM Router: All providers failed — ${details}`);
  combined.code = hasDailyQuota ? "DAILY_QUOTA_EXHAUSTED" : "ALL_PROVIDERS_FAILED";
  combined.status = hasDailyQuota ? 429 : 503;
  combined.providerErrors = errors;
  return combined;
}

export { shouldFallback };