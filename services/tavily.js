import { tavily } from "@tavily/core";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, "../.env"),
  override: true,
});

function normalizeEnvValue(value) {
  if (!value) return "";
  return value.trim().replace(/^['"]|['"]$/g, "");
}

const tavilyApiKey = normalizeEnvValue(process.env.TAVILY_API_KEY);

const tvly = tavilyApiKey
  ? tavily({
      apiKey: tavilyApiKey,
    })
  : null;

export async function searchInternet(query, { max_results = 3 } = {}) {
  if (!tvly) return "";

  try {
    const response = await tvly.search(query, {
      max_results,
    });

    return (response?.results ?? [])
      .slice(0, max_results)
      .map((r, i) => `${i + 1}. ${(r?.content || r?.snippet || "").slice(0, 300)}`)
      .join("\n");
  } catch (err) {
    console.log("Tavily search failed", err);
    return "";
  }
}

