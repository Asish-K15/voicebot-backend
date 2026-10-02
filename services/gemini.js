// Gemini API wrapper — uses @google/genai SDK
import { GoogleGenAI } from "@google/genai";

let geminiClient = null;

function getClient() {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error("GEMINI_API_KEY is not set"), { code: "MISSING_KEY" });
    }
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

export async function generateWithGemini({ messages, model, temperature, response_format }) {
  const client = getClient();
  // IMPORTANT: Always use a Gemini model. The "model" param may contain a Groq/model
  // name from the router fallback path (e.g. llama-3.1-8b-instant) which is invalid
  // on Gemini. Only accept explicit gemini-* model names.
  const requestedModel = model || "gemini-3.5-flash-lite";
  const geminiModel =
    String(requestedModel).toLowerCase().startsWith("gemini") &&
    !String(requestedModel).toLowerCase().includes("gemini-2.0") &&
    !String(requestedModel).toLowerCase().includes("gemini-3.6") &&
    !String(requestedModel).toLowerCase().includes("gemini-1.5")
      ? requestedModel
      : "gemini-3.5-flash-lite";

  // Convert OpenAI-style messages to Gemini format
  const systemMsg = messages.find((m) => m.role === "system");
  const history = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })) || [];

  // If there's a system message, prepend it to the first user message
  let systemInstruction = null;
  if (systemMsg) {
    systemInstruction = systemMsg.content;
  }

  const contents = history.slice(0, -1); // all except last
  const lastUserMsg = history[history.length - 1];

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const activeModel = geminiModel;

    try {
      const result = await client.models.generateContent({
        model: activeModel,
        contents: lastUserMsg ? [lastUserMsg] : [{ role: "user", parts: [{ text: "" }] }],
        config: {
          systemInstruction: systemInstruction || undefined,
          temperature: temperature ?? 0.5,
          maxOutputTokens: 2048,
          responseMimeType: response_format?.type === "json_object" ? "application/json" : "text/plain",
        },
      });

      // Normalize to OpenAI-compatible response structure
      return {
        choices: [
          {
            message: {
              role: "assistant",
              content: result.text || "",
            },
            finish_reason: "stop",
          },
        ],
        model: geminiModel,
        usage: {
          prompt_tokens: result.usageMetadata?.promptTokenCount || 0,
          completion_tokens: result.usageMetadata?.candidatesTokenCount || 0,
          total_tokens: result.usageMetadata?.totalTokenCount || 0,
        },
      };
    } catch (error) {
      const errMsg = String(error.message || "");
      const delayMatch = errMsg.match(/retry in ([0-9.]+)s/i);
      const parsedDelay = delayMatch ? Math.ceil(parseFloat(delayMatch[1])) * 1000 : 0;

      // Distinguish daily quota exhaustion and oversized requests (non-retryable)
      const isDailyQuota =
        /tokens per day|requests per day|perday|daily quota|generaterequestsperday/i.test(errMsg) ||
        parsedDelay > 60000;
      const isOversized = error.status === 413 || /context length|payload size|too large/i.test(errMsg);

      if (isDailyQuota || isOversized) {
        const failFastErr = new Error(isDailyQuota ? `Gemini daily quota exhausted: ${errMsg}` : `Gemini request oversized: ${errMsg}`);
        failFastErr.status = error.status || (isDailyQuota ? 429 : 413);
        failFastErr.code = isDailyQuota ? "DAILY_QUOTA_EXHAUSTED" : "REQUEST_OVERSIZED";
        failFastErr.nonRetryable = true;
        throw failFastErr;
      }

      const isTransient =
        error.status === 429 ||
        error.status === 503 ||
        errMsg.includes("429") ||
        errMsg.includes("503") ||
        errMsg.includes("high demand") ||
        errMsg.includes("Quota exceeded") ||
        errMsg.includes("RESOURCE_EXHAUSTED") ||
        errMsg.includes("fetch failed") ||
        errMsg.includes("ECONNRESET") ||
        errMsg.includes("ETIMEDOUT") ||
        errMsg.includes("ENOTFOUND") ||
        errMsg.includes("Connection error");

      if (isTransient && attempt < 2) {
        const waitMs = Math.min(Math.max(parsedDelay + 1000, 4000 * (attempt + 1)), 30000);
        console.warn(`[Gemini] Transient rate limit or 503, waiting ${waitMs}ms before retry ${attempt + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      const err = new Error(error.message || "Gemini API error");
      err.status = error.status || 503;
      err.code = error.code || "GEMINI_ERROR";
      throw err;
    }
  }

  // If all attempts failed without returning, throw lastErr
  const exhaustedErr = new Error(lastErr?.message || "Gemini API error: all retry attempts failed");
  exhaustedErr.status = lastErr?.status || 503;
  exhaustedErr.code = lastErr?.code || "GEMINI_MAX_RETRIES_EXCEEDED";
  throw exhaustedErr;
}