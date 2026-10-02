// Intent router for routing between local KB and web search.
// Deterministic + lightweight for demo reliability.

export function detectIntent(message) {
  const text = (message ?? "").toLowerCase().trim();

  const tokens = text.match(/[a-z0-9]+/g) || [];
  const tokenSet = new Set(tokens);

  // Helper: token/phrase matching only (no substring matching)
  const hasToken = (t) => tokenSet.has(t);

  const tokenString = ` ${tokens.join(" ")} `;
  const hasPhraseTokens = (phrase) => {
    const pTokens = phrase.split(/\s+/).filter(Boolean);
    if (pTokens.length === 1) return hasToken(pTokens[0]);
    // phrase like "ai news" => require both tokens in order
    return tokenString.includes(` ${pTokens.join(" ")} `);
  };

  // -----------------
  // Navigation (highest priority)
  // -----------------
  const isNavigationQuery =
    (text.includes("where is") || text.includes("location") || text.includes("directions")) ||
    hasToken("campus");


  if (isNavigationQuery) {
    // Keep navigation/map intents as higher priority.
    // If it contains map-relevant entities, return navigation.
    if (hasToken("campus") || hasToken("hostel") || hasToken("library") || hasToken("placement")) {
      return "navigation";
    }
  }

  // -----------------
  // Time-sensitive Web (strict token/phrase matching; no substring)
  // -----------------
  // Order is controlled by routing rules in this section.
  // Note: matching is based on tokens/phrases only.

  const webTokenOrder = [
    "latest",
    "today",
    "yesterday",
    "current",
    "news",
    "live",
    "weather",
    "price",
    "score",
    "bitcoin",
    "stock",
    "forecast",
  ];

  const webPhraseOrder = [
    // "AI news" style (kept token-based)
    "ai news",
  ];

  // Token-based exact match
  for (const w of webTokenOrder) {
    if (hasToken(w)) return "web";
  }

  // Phrase-based exact match
  for (const p of webPhraseOrder) {
    if (hasPhraseTokens(p)) return "web";
  }

  // -----------------
  // University (Admissions / CUTM KB)
  // -----------------
  // University keywords (token-based via tokenSet), plus a small number of exact phrase checks.

  // Admission keywords
  const admissionTokens = [
    "admission",
    "apply",
    "counselling",
    "counseling",
    "eligibility",
    "cutm",
    "cuee",
  ];

  const isAdmission = admissionTokens.some(hasToken) || ["admission", "apply", "cutm"].some((t) => tokenSet.has(t));

  // University topics (word/token matching only)
  const universityTokens = [
    "course",
    "courses",
    "syllabus",
    "curriculum",
    "fee",
    "fees",
    "tuition",
    "tuition fee",
    "btech",
    "b.tech",
    "mba",
    "mca",
    "bca",
    "bba",
    "cse",
    "ece",
    "eee",
    "diploma",
    "hostel",
    "scholarship",
    "scholarships",
    "placement",
    "placements",
    "recruiters",
    "department",
    "faculty",
    "library",
    "lab",
    "transport",
    "bus",
    "exam",
    "examination",
    "semester",
    "results",
    "campus",
    "clubs",
    "events",
    "emergency",
    "health",
    "calendar",
  ];

  const isUniversity = universityTokens.some(hasToken);

  // University AI aliases (token/phrase matching only; never includes("ai"))
  const aiAliasPhrases = [
    "artificial intelligence",
    "machine learning",
    "deep learning",
    "computer vision",
  ];

  const aiAliasTokens = [
    "ai",
    "ml",
    "nlp",
    "learning",
    "intelligence",
    "artificial",
    "machine",
  ];

  const isAIUniversityIntent = aiAliasTokens.some(hasToken) || aiAliasPhrases.some(hasPhraseTokens);

  // Admission vs University
  // Admission should be more specific when admission signals exist.
  if (isAdmission) {
    // If it also matches university context, classify admission.
    // Otherwise treat as general (fallback), but for this project routing uses admission.
    return "admission";
  }

  // If AI university intent + university topic keywords, classify as university.
  if (isAIUniversityIntent) {
    if (isUniversity) return "university";
    // If user asks "Artificial Intelligence" alone, still treat as university.
    return "university";
  }

  if (isUniversity) return "university";

  // -----------------
  // General (default)
  // -----------------
  return "general";
}

