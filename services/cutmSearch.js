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

const CUTM_DOMAINS = [
  "cutm.ac.in",
  "admissions.cutm.ac.in",
  "results.cutm.ac.in",
  "erp.cutm.ac.in",
  "careers.cutm.ac.in",
  "library.cutm.ac.in",
  "placement.cutm.ac.in",
];

export async function searchCUTMOfficial(query, { max_results = 3 } = {}) {
  if (!tvly) return "";

  try {
    const response = await tvly.search(query, {
      max_results,
      include_domains: CUTM_DOMAINS,
      search_depth: "advanced",
      include_answer: true,
    });

    // Tavily returns a rich response; we only inject text snippets.
    const answer =
      (response?.answer && String(response.answer).trim()) || "";

    const resultsText = (response?.results ?? [])
      .slice(0, max_results)
      .map((r, i) => `${i + 1}. ${(r?.content || r?.snippet || "").slice(0, 300)}`)
      .join("\n");

    const combined = [
      answer ? `Answer: ${answer}` : "",
      resultsText,
    ]
      .filter(Boolean)
      .join("\n");

    return combined;
  } catch (err) {
    console.log("CUTM official search failed", err);
    return "";
  }
}

