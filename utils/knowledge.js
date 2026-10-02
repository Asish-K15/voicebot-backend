// Local CUTM knowledge utilities.
// Contains:
// - hasEnoughKnowledge(text)
// - getRelevantContext(question): scoring-based retrieval over university.txt

export function hasEnoughKnowledge(text) {
  if (!text) return false;

  const cleaned = String(text).trim();
  if (cleaned.length < 250) return false;

  const lowered = cleaned.toLowerCase();
  if (
    lowered.includes("no information") ||
    lowered.includes("not found") ||
    lowered.includes("no matching")
  ) {
    return false;
  }

  return true;
}

// -----------------------------
// Knowledge base loading/parsing
// -----------------------------

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let cachedSections = null;

function tokenizeForMatch(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "of",
  "for",
  "and",
  "or",
  "to",
  "in",
  "on",
  "at",
  "with",
  "by",
  "from",
  "this",
  "that",
  "it",
  "as",
  "are",
  "be",
  "was",
  "were",
  "you",
  "your",
  "i",
  "we",
  "they",
  "he",
  "she",
  "them",
  "our",
  "us",
  "about",
  "what",
  "which",
  "who",
  "where",
  "when",
  "why",
  "how",
]);

function dropStopTokens(tokens) {
  return tokens.filter((t) => !STOP_WORDS.has(t));
}

function parseSectionsFromText(universityData) {
  // Parse sections like: [ABOUT] ... [COURSES] ...
  const sectionRegex = /\[([^\]]+)\]([\s\S]*?)(?=\[[^\]]+\]|$)/gi;
  const sections = [];

  let m = null;
  while ((m = sectionRegex.exec(universityData))) {
    const heading = String(m[1] || "").trim().toUpperCase();
    const content = String(m[2] || "").trim();
    if (!heading || !content) continue;
    sections.push({ heading, content });
  }

  return sections;
}

function readTextFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function loadUniversitySections() {
  // Best-effort fallback for migration period:
  // - Prefer domain-based knowledge in knowledge/*.txt via university.json
  // - Fallback to ../university.txt if domain files are missing/empty or no mapped domains found
  if (cachedSections) return cachedSections;

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const knowledgeDir = path.join(__dirname, "../knowledge");
  const indexPath = path.join(knowledgeDir, "university.json");
  const fallbackPath = path.join(__dirname, "../university.txt");

  let index = null;
  try {
    const raw = readTextFileSafe(indexPath);
    index = raw ? JSON.parse(raw) : null;
  } catch {
    index = null;
  }

  // If index missing, fallback immediately.
  if (!index || typeof index !== "object") {
    const fallback = readTextFileSafe(fallbackPath);
    cachedSections = parseSectionsFromText(fallback);
    return cachedSections;
  }

  // Load ALL mapped domain files, then let existing scoring in getRelevantContext()
  // decide the best matching sections for the actual user question.
  const domainFiles = new Set();
  for (const v of Object.values(index)) {
    if (Array.isArray(v)) {
      for (const domainName of v) domainFiles.add(domainName);
    }
  }

  let mergedText = "";
  let anyDomainLoaded = false;
  for (const domainName of domainFiles) {
    const domainPath = path.join(knowledgeDir, `${domainName}.txt`);
    const t = readTextFileSafe(domainPath);
    if (t && t.trim()) {
      anyDomainLoaded = true;
      mergedText += `\n${t.trim()}\n`;
    }
  }

  if (!anyDomainLoaded) {
    const fallback = readTextFileSafe(fallbackPath);
    cachedSections = parseSectionsFromText(fallback);
    return cachedSections;
  }

  // Safety: include original university.txt as well during migration so we
  // don't accidentally miss headings that haven't been migrated yet.
  const fallback = readTextFileSafe(fallbackPath);
  if (fallback && fallback.trim()) {
    mergedText += `\n${fallback.trim()}\n`;
  }

  cachedSections = parseSectionsFromText(mergedText);
  return cachedSections;
}



function getQueryNorm(q) {
  return String(q || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

  // Abbreviation normalizer: maps short forms to their expanded tokens for matching.
  const ABBREVIATION_MAP = new Map([
    ["btech", ["bachelor", "technology"]],
    ["b.tech", ["bachelor", "technology"]],
    ["b tech", ["bachelor", "technology"]],
    ["ai", ["artificial", "intelligence"]],
    ["cse", ["computer", "science", "engineering"]],
    ["cs", ["computer", "science"]],
    ["ece", ["electronics", "communication", "engineering"]],
    ["eee", ["electrical", "electronics", "engineering"]],
    ["me", ["mechanical", "engineering"]],
    ["mba", ["master", "business", "administration"]],
    ["mca", ["master", "computer", "applications"]],
    ["bca", ["bachelor", "computer", "applications"]],
    ["bba", ["bachelor", "business", "administration"]],
    ["ml", ["machine", "learning"]],
    ["nlp", ["natural", "language", "processing"]],
    ["aiml", ["artificial", "intelligence", "machine", "learning"]],
  ]);

  // Expand abbreviations in a token array
  function expandAbbreviations(tokens) {
    const result = [];
    for (const t of tokens) {
      const expansion = ABBREVIATION_MAP.get(t);
      if (expansion) {
        result.push(t);       // keep original token
        result.push(...expansion); // add expanded tokens
      } else {
        result.push(t);
      }
    }
    return result;
  }

  // Synonyms: base word → its alternate forms
  const synonyms = new Map([
    ["hostel", ["accommodation", "room"]],
    ["fees", ["fee", "cost", "charges", "tuition"]],
    ["fee", ["fees", "cost", "charges", "tuition"]],
    ["placements", ["placement", "jobs", "recruiters", "campus recruitment"]],
    ["admissions", ["admission", "apply", "counselling", "counseling", "eligibility"]],
    ["courses", ["course", "program", "programme", "curriculum"]],
    ["campus", ["campuses", "location", "vizianagaram"]],
    ["calendar", ["events", "schedule"]],
    ["scholarships", ["scholarship"]],
    ["tuition", ["fee", "fees", "cost"]],
    ["exam", ["examination", "test"]],
    ["transport", ["bus", "conveyance"]],
    ["semester", ["annual", "year"]],
  ]);
  // Conservative singular/plural folding — used ONLY inside scoreSection().
  // Makes equivalent: campus<->campuses, location<->locations, fee<->fees,
  // admission<->admissions, course<->courses, address<->addresses, ...
  // Deliberately NOT a full stemmer:
  //   - "...ses" -> strip "es"   (campuses->campus, courses->course, addresses->address)
  //   - "...s"   -> strip "s"    (locations->location, fees->fee, admissions->admission)
  //   - protected endings: "us" (campus), "ss" (business), "is" (analysis)
  // Idempotent: foldPlural(foldPlural(x)) === foldPlural(x).
  function foldPlural(token) {
    const t = String(token || "");
    if (t.length > 4 && t.endsWith("ses")) return t.slice(0, -2);
    if (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us") && !t.endsWith("is")) return t.slice(0, -1);
    return t;
  }



function scoreSection({ heading, content }, question) {
  const qRaw = String(question || "").trim();
  if (!qRaw) return 0;
  const qNorm = getQueryNorm(qRaw);

  const headingUpper = String(heading || "");
  const contentLower = String(content || "").toLowerCase();
  const headingNorm = getQueryNorm(headingUpper);

  // Tokenize everything, expand abbreviations EARLY (BEFORE scoring)
  const qTokens = dropStopTokens(tokenizeForMatch(qNorm));
  const headingTokens = dropStopTokens(tokenizeForMatch(headingNorm));
  const contentTokens = dropStopTokens(tokenizeForMatch(contentLower));

  const qTokensExpanded = expandAbbreviations(qTokens).map(foldPlural);
  const qTokenSet = new Set(qTokensExpanded);

  const headingTokensExpanded = expandAbbreviations(headingTokens).map(foldPlural);
  const headingTokenSet = new Set(headingTokensExpanded);

  const contentTokenSet = new Set(expandAbbreviations(contentTokens).map(foldPlural));

  let score = 0;

  // ============================================================
  // PRIORITY 1: EXACT HEADING MATCH (+100)
  // If the question directly matches a section heading, boost it massively.
  // E.g. "registrar" matches [REGISTRAR] or [LEADERSHIP_TEAM] if heading contains "registrar"
  // ============================================================
  const qRawLower = qRaw.toLowerCase();
  const headingLower = headingUpper.toLowerCase();

  const isExperimental = process.env.EXPERIMENTAL_RETRIEVAL === "true";

  if (isExperimental) {
    const headingClean = headingLower.replace(/_/g, " ").trim();
    const headingWords = headingClean.split(/\s+/).filter(Boolean);
    const escapedClean = headingClean.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const phraseRegex = new RegExp(`\\b${escapedClean}(?:s|es)?\\b`, "i");

    if (headingClean === qRawLower || phraseRegex.test(qRawLower)) {
      // Specificity bonus: multi-word headings (e.g. "vice chancellor" = 2 words)
      // score higher than single-word headings (e.g. "chancellor" = 1 word)
      score += 100 + (headingWords.length * 20);
    } else if (headingLower.includes(qRawLower) || (qRawLower.length < 50 && qRawLower.includes(headingLower))) {
      score += 100;
    }

    // Entity-aware: CUEE Exam / Application Fee queries
    const isCueeQuery = /\bcuee\b/i.test(qRawLower);
    if (isCueeQuery) {
      if (headingUpper === "CUEE_EXAM" || headingUpper === "APPLICATION_PROCESS" || headingUpper === "ADMISSION_PROCESS") {
        score += 80;
      }
      if (headingUpper.endsWith("_FEES") && !headingUpper.includes("CUEE")) {
        score -= 80;
      }
    }

    // Entity-aware: Fee type disambiguation (hostel vs academic)
    const isHostelFeeQuery = /\bhostel\b/i.test(qRawLower) && /\b(fee|fees|cost|charge|charges|rent|living|accommodation)\b/i.test(qRawLower);
    const isAcademicFeeQuery = /\b(btech|b\.tech|mba|mca|bca|bba|diploma|mtech|phd|bpharm|course|tuition)\b/i.test(qRawLower);
    if (isHostelFeeQuery && !isAcademicFeeQuery) {
      if (headingUpper.includes("HOSTEL")) score += 40;
      if (headingUpper.endsWith("_FEES") && !headingUpper.includes("HOSTEL")) score -= 80;
    }

    // Entity-aware: Cross-campus comparison & Campus Entity handling
    const campuses = ["paralakhemundi", "bhubaneswar", "balangir", "rayagada", "balasore", "chatrapur", "vizianagaram"];
    const mentionedCampuses = campuses.filter((c) => qRawLower.includes(c));
    const isComparisonQuery = /\b(compare|comparison|difference|differences|versus|vs|between)\b/i.test(qRawLower);
    if (isComparisonQuery && mentionedCampuses.length >= 2) {
      if (headingUpper === "CAMPUSES" || headingUpper === "CAMPUS_LOCATIONS" || headingUpper === "HOSTEL") {
        score += 50;
      }
    } else if (mentionedCampuses.length > 0) {
      // Single or multiple campus query — boost general campus directory if asked with facilities/info
      if (headingUpper === "CAMPUSES" || headingUpper === "CAMPUS_LOCATIONS") {
        score += 35;
      }
    }
  } else {
    // Frozen baseline Priority 1
    if (headingLower === qRawLower || headingLower.includes(qRawLower) || qRawLower.includes(headingLower)) {
      score += 100;
    }
  }

  // ============================================================
  // PRIORITY 2: ALIAS MATCH (+60)
  // Check the "Aliases:" line in the section content
  // ============================================================
  const aliasLine = (content || "").split("\n").find((l) => l.trim().toLowerCase().startsWith("aliases:"));
  if (aliasLine) {
    const aliasTokens = tokenizeForMatch(aliasLine.replace(/^aliases:\s*/i, ""));
    const aliasExpanded = expandAbbreviations(dropStopTokens(aliasTokens));
    for (const at of aliasExpanded) {
      if (qTokenSet.has(foldPlural(at))) {
        score += 60;
        break; // Only +60 once per alias match
      }
    }
  }

  // ============================================================
  // PRIORITY 3: KEYWORD MATCH (+40 per matching keyword)
  // ============================================================
  const keywordLine = (content || "").split("\n").find((l) => l.trim().toLowerCase().startsWith("keywords:"));
  if (keywordLine) {
    const keywordTokens = tokenizeForMatch(keywordLine.replace(/^keywords:\s*/i, ""));
    const keywordExpanded = expandAbbreviations(dropStopTokens(keywordTokens));
    // Step 3 FIX 1: distinct-token matching — each (folded) query token
    // contributes the +40 keyword bonus at most once per section. Previously
    // every matching occurrence added +40, so over-keyworded sections such as
    // BTECH_FEES (~29 token occurrences) scored kw:1160 and drowned the
    // +100 heading boost of the genuinely relevant sections.
    const matchedKeywords = new Set();
    for (const kt of keywordExpanded) {
      const folded = foldPlural(kt);
      if (qTokenSet.has(folded)) matchedKeywords.add(folded);
    }
    score += matchedKeywords.size * 40;
  }

  // ============================================================
  // PRIORITY 4: HEADING OVERLAP MATCH (+30)
  // Uses percentage threshold
  // ============================================================
  if (headingTokenSet.size > 0) {
    let headingTokensFound = 0;
    for (const ht of headingTokenSet) {
      if (qTokenSet.has(ht)) headingTokensFound++;
    }
    const overlap = headingTokensFound / headingTokenSet.size;
    if (overlap >= 0.5) {
      score += 30;
    }
  }

  // ---- HEADING TOKEN OVERLAP (+15 per matching token) ----
  for (const t of qTokenSet) {
    if (headingTokenSet.has(t)) {
      score += 15;
    }
  }

  // ============================================================
  // PRIORITY 5: RELATED TOPICS MATCH (+20)
  // ============================================================
  const relatedLine = (content || "").split("\n").find((l) => l.trim().toLowerCase().startsWith("related topics:"));
  if (relatedLine) {
    const relatedTokens = tokenizeForMatch(relatedLine.replace(/^related topics:\s*/i, ""));
    const relatedExpanded = expandAbbreviations(dropStopTokens(relatedTokens));
    for (const rt of relatedExpanded) {
      if (qTokenSet.has(foldPlural(rt))) score += 20;
    }
  }

  // ============================================================
  // PRIORITY 6: OVERVIEW MATCH (+15)
  // ============================================================
  const overviewLine = (content || "").split("\n").find((l) => l.trim().toLowerCase().startsWith("overview:"));
  if (overviewLine) {
    const overviewTokens = tokenizeForMatch(overviewLine.replace(/^overview:\s*/i, ""));
    const overviewExpanded = expandAbbreviations(dropStopTokens(overviewTokens));
    for (const ot of overviewExpanded) {
      if (qTokenSet.has(foldPlural(ot))) score += 15;
    }
  }

  // ============================================================
  // PRIORITY 7: DETAILS MATCH (+8)
  // ============================================================
  const detailsLine = (content || "").split("\n").find((l) => l.trim().toLowerCase().startsWith("details:"));
  if (detailsLine) {
    const detailsTokens = tokenizeForMatch(detailsLine.replace(/^details:\s*/i, ""));
    const detailsExpanded = expandAbbreviations(dropStopTokens(detailsTokens));
    for (const dt of detailsExpanded) {
      if (qTokenSet.has(foldPlural(dt))) score += 8;
    }
  }

  // ---- SYNONYM MATCH (+8 heading, +4 content) ----
  for (const [base, syns] of synonyms.entries()) {
    if (!qTokenSet.has(foldPlural(base))) continue;
    for (const syn of syns) {
      const synTokens = expandAbbreviations(dropStopTokens(tokenizeForMatch(syn)));
      for (const st of synTokens) {
        if (headingTokenSet.has(foldPlural(st))) { score += 8; break; }
      }
      for (const st of synTokens) {
        if (contentTokenSet.has(foldPlural(st))) { score += 4; break; }
      }
    }
  }

  // ---- PHRASE MATCH (+8) ----
  if (qNorm.length >= 3) {
    if (headingNorm.includes(qNorm)) score += 8;
    if (contentLower.includes(qNorm)) score += 8;
  }

  // ---- CONTENT TOKEN MATCH (+1 per token, capped) ----
  let contentMatches = 0;
  for (const t of qTokenSet) {
    if (contentTokenSet.has(t)) {
      contentMatches++;
    }
  }
  score += Math.min(contentMatches * 1, 6);

  return score;
}

function getRelevantContext(question) {
  const sections = loadUniversitySections();
  const q = String(question || "").trim();
  if (!q) return "";
  if (!sections.length) return "";

  const scored = sections.map((s) => ({ ...s, score: scoreSection(s, q) }));
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score <= 0) return "";

  const maxSections = process.env.RETRIEVAL_MAX_SECTIONS ? parseInt(process.env.RETRIEVAL_MAX_SECTIONS, 10) : 4;

  // Include top sections that score at least 50% of the best score
  // This returns more relevant context for complex queries
  const chosen = [];
  for (const s of scored) {
    if (s.score >= best.score * 0.5) {
      chosen.push(s);
    }
    if (chosen.length >= maxSections) break; // Return up to maxSections (default: 4)
  }

  const uniq = new Map();
  for (const c of chosen) uniq.set(c.heading, c);

  return [...uniq.values()]
    .slice(0, maxSections)
    .map((s) => `[${s.heading}]\n${s.content}`)
    .filter((t) => t.trim())
    .join("\n\n");
}

export { getRelevantContext, scoreSection };