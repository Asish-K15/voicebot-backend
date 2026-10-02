import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateLLMResponse } from "./services/llmRouter.js";
import mongoose from "mongoose";

import { searchInternet } from "./services/tavily.js";
import { searchCUTMOfficial } from "./services/cutmSearch.js";
import { buildAIContext } from "./services/aiContext.js";

import { getConversation, updateConversation } from "./services/conversationMemory.js";


import Conversation from "./models/Conversation.js";

import { detectIntent } from "./utils/intent.js";
import { hasEnoughKnowledge, getRelevantContext } from "./utils/knowledge.js";

// ─── Performance Profiler (per-request) ─────────────────────────────────────
function createProfiler() {
  const start = performance.now();
  const marks = {};

  return {
    mark(name) {
      marks[name] = performance.now();
    },
    print() {
      const keys = Object.keys(marks);
      if (keys.length < 2) return;

      const labelWidth = 22;
      const separator = "=".repeat(labelWidth + 13);

      console.log("\n" + separator);
      console.log("VoiceBot Performance");
      console.log(separator);

      let prev = start;
      for (const label of keys) {
        const t = marks[label];
        const elapsed = t - prev;
        const padded = label.padEnd(labelWidth);
        console.log(`${padded} ${elapsed.toFixed(0).padStart(6)} ms`);
        prev = t;
      }

      // TOTAL = last mark - start
      const lastLabel = keys[keys.length - 1];
      const total = marks[lastLabel] - start;
      console.log(`${"TOTAL".padEnd(labelWidth)} ${total.toFixed(0).padStart(6)} ms`);
      console.log(separator + "\n");
    },
  };
}
// ─── End Performance Profiler ────────────────────────────────────────────────


import auth from "./middleware/auth.js";
import optionalAuth from "./middleware/optionalAuth.js";
import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/user.js";
import chatRoutes from "./routes/chat.js";
import conversationRoutes from "./routes/conversations.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.join(__dirname, ".env"),
  override: true,
});

function normalizeEnvValue(value) {
  if (!value) return "";
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function setNormalizedEnv(name) {
  const value = normalizeEnvValue(process.env[name]);
  if (value) process.env[name] = value;
  return value;
}

const groqApiKey = setNormalizedEnv("GROQ_API_KEY");
const mongoUri = setNormalizedEnv("MONGO_URI");
const jwtSecret = setNormalizedEnv("JWT_SECRET");

const tavilyApiKey = setNormalizedEnv("TAVILY_API_KEY");
const allowedOrigin = setNormalizedEnv("ALLOWED_ORIGIN");
const groqModel = setNormalizedEnv("GROQ_MODEL");
const port = setNormalizedEnv("PORT") || 3000;

const app = express();

if (!mongoUri) {
  console.warn(
    "WARNING: MONGO_URI is missing or empty. Add it to voicebot-backend/.env. Auth endpoints will not work until MongoDB is configured."
  );
}

if (!jwtSecret) {
  console.warn(
    "WARNING: JWT_SECRET is missing or empty. Auth endpoints will not work until it is configured."
  );
}

if (mongoUri) {
  console.log("Attempting MongoDB connection...");

  mongoose
    .connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
    })
    .then(() => {
      console.log("✅ MongoDB connected");
    })
    .catch((err) => {
      console.error("❌ MongoDB connection error:");
      console.error(err.message);
      console.error(err);
    });
}

app.use(
  cors({
    origin: allowedOrigin || true,
    credentials: true,
  })
);
app.use(express.json());

let universityData = "";
try {
  universityData = fs.readFileSync(path.join(__dirname, "university.txt"), "utf8");
} catch (err) {
  console.log("university.txt not found");
}

app.get("/", (req, res) => {
  res.send("Voicebot backend running");
});

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/chat/conversations", conversationRoutes);

function extractSection(sectionName) {
  const regex = new RegExp(`\\[${sectionName}\\]([\\s\\S]*?)(?=\\[|$)`, "i");
  const match = universityData.match(regex);
  return match ? match[1].trim() : "";
}

function isCenturionQuestion(message, history) {
  const text = `${message}\n${history}`.toLowerCase();
  return text.includes("centurion") || text.includes("cutm");
}

function makeConversationTitle(text) {
  const title = (text || "").trim().replace(/\s+/g, " ");
  if (!title) return "New Chat";
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
}

function normalizeConversationMessage(msg) {
  return {
    role: msg.role,
    text: msg.text || "",
    speak: msg.speak || msg.text || "",
    intent: msg.intent || "GENERAL_CHAT",
    quickActions: Array.isArray(msg.quickActions) ? msg.quickActions : [],
    buttons: Array.isArray(msg.buttons) ? msg.buttons : [],
    map: msg.map ?? null,
    metadata: msg.metadata ?? {},
    links: Array.isArray(msg.links) ? msg.links : [],
    conversationState: msg.conversationState ?? {},
  };
}

app.post("/chat", optionalAuth, async (req, res) => {
  const perf = createProfiler();
  try {
    if (!groqApiKey) {
      return res.status(500).json({
        reply: "GROQ_API_KEY is missing in the backend .env file. Add it and restart the server.",
      });
    }

    const userMessage = (req.body.message || "").trim();
    const conversationId = req.body.conversationId || "";
    const options = req.body.options || {};

    const incomingMessages = Array.isArray(req.body.messages) ? req.body.messages : null;
    const guestHistory = incomingMessages
      ? incomingMessages
          .slice(-8)
          .filter((m) => m && (m.role === "user" || m.role === "assistant"))
          .map((m) => ({ role: m.role, content: String(m.content || "") }))
          .filter((m) => m.content.trim())
      : [];

    const memoryEnabled = options.memoryEnabled !== false;
    const internetEnabled = options.internetEnabled !== false;
    const personality = options.personality || "Friendly";

    if (!userMessage) {
      return res.status(400).json({ reply: "Please enter a message." });
    }

    const userId = req.user?.id;

    let conversation = null;

    if (userId) {
      conversation = conversationId
        ? await Conversation.findOne({ _id: conversationId, userId })
        : null;

      if (conversationId && !conversation) {
        return res.status(404).json({ reply: "Conversation not found." });
      }

      if (!conversation) {
        conversation = await Conversation.create({
          userId,
          title: makeConversationTitle(userMessage),
          messages: [],
        });
      }

      conversation.messages.push({ role: "user", text: userMessage });
    }

    const limitedMessages = memoryEnabled && conversation ? conversation.messages.slice(-8) : [];

    const history = limitedMessages.map((m) => `${m.role}: ${m.text}`).join("\n");

    const groqHistoryMessages = (userId ? limitedMessages : guestHistory)
      .slice(-8)
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.text ?? m.content,
      }))
      .filter((m) => (m.content || "").trim());

    const intent = detectIntent(userMessage);
    perf.mark("Intent Detection");

    // Session memory resolution:
    // 1. Authenticated user: keyed by userId
    // 2. Explicit conversation: keyed by conversationId
    // 3. Multi-turn guest session: keyed by incoming messages session or a guest identifier
    // 4. Standalone guest request (no conversationId, no messages): isolated fresh session
    const isMultiTurnGuest = !userId && !conversationId && guestHistory.length > 0;
    const sessionKey = userId
      ? `user_${userId}`
      : (conversationId
          ? `conv_${conversationId}`
          : (isMultiTurnGuest ? 'GUEST_ACTIVE_SESSION' : null));

    const state = sessionKey ? getConversation(sessionKey) : {
      currentCourse: null,
      currentCampus: null,
      currentTopic: null,
      lastIntent: null,
      currentYear: null,
      currentBranch: null,
      preferredLanguage: null,
      userGoals: null,
      lastAnsweredTopic: null,
    };
    perf.mark("Conversation Memory");

    const q = userMessage.toLowerCase();

    // Specific entity recognition (programs, degrees, exams, services)
    const SPECIFIC_ENTITY_REGEX = /\b(cuee|btech|b\.tech|mtech|m\.tech|mba|mca|bba|bca|bsc|msc|bcom|mcom|bpharm|mpharm|dpharm|diploma|phd|ph\.d|cse|ece|eee|mechanical|civil|mining|aerospace|biotechnology|hostel|mess|transport|scholarship|placement)\b/i;
    const namesSpecificEntity = SPECIFIC_ENTITY_REGEX.test(q);

    // Update memory based on course/course-related keywords.
    const courseMap = [
      { key: 'artificial intelligence', course: 'Artificial Intelligence' },
      { key: 'ai', course: 'Artificial Intelligence' },
      { key: 'machine learning', course: 'Machine Learning' },
      { key: 'ml', course: 'Machine Learning' },
      { key: 'mba', course: 'MBA' },
      { key: 'btech', course: 'BTech' },
      { key: 'b.tech', course: 'BTech' },
      { key: 'b tech', course: 'BTech' },
      { key: 'mca', course: 'MCA' },
      { key: 'bca', course: 'BCA' },
      { key: 'bba', course: 'BBA' },
      { key: 'diploma', course: 'Diploma' },
      { key: 'phd', course: 'PhD' },
      { key: 'ph.d', course: 'PhD' },
    ];

    const isCourseQuery = q.includes('course') || q.includes('program') || q.includes('programme') || q.includes('syllabus') || q.includes('degree');

    if (isCourseQuery || namesSpecificEntity) {
      const matched = courseMap.find((m) => q.includes(m.key));
      if (matched) {
        state.currentCourse = matched.course;
        state.currentTopic = 'course';
        if (sessionKey) {
          updateConversation(sessionKey, {
            currentCourse: matched.course,
            currentTopic: 'course',
          });
        }
      }
    }

    // CUEE entrance exam handling: CUEE is an entrance examination, not an academic course
    if (q.includes('cuee')) {
      state.currentTopic = 'CUEE';
      state.currentCourse = null;
      state.currentBranch = null;
      if (sessionKey) {
        updateConversation(sessionKey, {
          currentTopic: 'CUEE',
          currentCourse: null,
          currentBranch: null,
        });
      }
    }

    // Campus memory
    if (q.includes('vizianagaram')) {
      state.currentCampus = 'Vizianagaram';
      if (sessionKey) updateConversation(sessionKey, { currentCampus: 'Vizianagaram' });
    }

    // Admission topic memory (do not tag refund/cancellation queries as Admissions)
    if ((q.includes('admission') || q.includes('eligibility')) && !q.includes('cuee') && !q.includes('refund') && !q.includes('cancel')) {
      state.currentTopic = 'Admissions';
      if (sessionKey) updateConversation(sessionKey, { currentTopic: 'Admissions' });
    }
    if (q.includes('refund') || q.includes('cancel') || q.includes('cancellation') || q.includes('withdraw')) {
      state.currentTopic = 'Refund';
      if (sessionKey) updateConversation(sessionKey, { currentTopic: 'Refund' });
    }

    // Intent-aware memory
    if (sessionKey) {
      updateConversation(sessionKey, { lastIntent: intent === 'web' ? 'web' : 'university' });
    }

    // Detect year, branch, goals from user messages
    const yearMatch = q.match(/(\d+)(?:st|nd|rd|th)?\s*(?:year|sem)/);
    if (yearMatch) {
      state.currentYear = yearMatch[1];
      if (sessionKey) updateConversation(sessionKey, { currentYear: yearMatch[1] });
    }

    const branchKeywords = [
      { key: 'cse', branch: 'CSE' },
      { key: 'computer science', branch: 'CSE' },
      { key: 'ece', branch: 'ECE' },
      { key: 'eee', branch: 'EEE' },
      { key: 'mechanical', branch: 'Mechanical' },
      { key: 'civil', branch: 'Civil' },
      { key: 'mba', branch: 'MBA' },
      { key: 'bca', branch: 'BCA' },
    ];
    for (const bk of branchKeywords) {
      if (q.includes(bk.key) && !q.includes('cuee')) {
        state.currentBranch = bk.branch;
        if (sessionKey) updateConversation(sessionKey, { currentBranch: bk.branch });
        break;
      }
    }

    // Rewrite follow-up queries using memory context before retrieval/LLM.
    // This ONLY applies to genuine follow-up queries that do NOT name an explicit entity.
    // This prevents clobbering entity-specific queries (e.g. "How much is the CUEE application fee?").
    let rewrittenUserMessage = userMessage;
    if (state?.currentCourse && !namesSpecificEntity) {
      const c = state.currentCourse;
      const follows = q;

      if (follows.includes('duration')) {
        rewrittenUserMessage = `What is the duration of ${c} course?`;
      } else if (follows.includes('fees') || follows.includes('fee') || follows.includes('cost')) {
        rewrittenUserMessage = `What are the fees for ${c} course?`;
      } else if (follows.includes('placement') || follows.includes('placements')) {
        rewrittenUserMessage = `Placement information for ${c} course.`;
      } else if (follows.includes('eligibility')) {
        rewrittenUserMessage = `Eligibility for ${c} course.`;
      }
    }

    if (state?.currentCampus && !namesSpecificEntity && (q.includes('hostel') || q.includes('fees') || q.includes('fee') || q.includes('contact'))) {
      rewrittenUserMessage = rewrittenUserMessage.replace(/ (hostel|fees|fee|contact) /i, (m) => m);
      if (!rewrittenUserMessage.toLowerCase().includes('vizianagaram')) {
        rewrittenUserMessage = `${rewrittenUserMessage} in ${state.currentCampus} campus`;
      }
    }

    // Only rewrite to generic "Admission fees" when the message does not name a specific entity
    // and does NOT ask about a specific fee topic (e.g. refunds, cancellations, payment methods, installments, hostels)
    const isSpecificFeeTopic = /refund|cancel|cancellation|withdraw|withdrawal|online|pay|payment|method|mode|installment|exam|hostel|transport|mess|bus|structure|breakdown/i.test(q);
    if (state?.currentTopic === 'Admissions' && (q.includes('fees') || q.includes('fee')) && !namesSpecificEntity && !isSpecificFeeTopic) {
      rewrittenUserMessage = `Admission fees`;
    }

    // Apply rewrite for subsequent steps
    const effectiveUserMessage = rewrittenUserMessage;

    // Determine active course/branch for LLM prompt context injection:
    // If current question names a specific entity (like CUEE or a different course),
    // do NOT inject a stale course into the LLM context.
    const activeCourse = (namesSpecificEntity && state?.currentCourse && !q.includes(state.currentCourse.toLowerCase()))
      ? ""
      : (state?.currentCourse || "");
    const activeBranch = (namesSpecificEntity && state?.currentBranch && !q.includes(state.currentBranch.toLowerCase()))
      ? ""
      : (state?.currentBranch || "");

    console.log(`[Diagnostic Step 7] q: "${userMessage}" | sessionKey: ${sessionKey} | namesEntity: ${namesSpecificEntity} | rewritten: "${effectiveUserMessage}" | activeCourse: "${activeCourse}"`);

    const relevantKnowledge = getRelevantContext(effectiveUserMessage);
    perf.mark("Knowledge Retrieval");

    // Mixed queries: "Tell me about AI and today's weather" should fetch both KB + web.
    // Pure web queries discard local knowledge. Mixed queries keep it.
    const hasWebTokens = /weather|forecast|temperature|rain|news|headline|stock|share price|bitcoin|crypto|live score|match|today's weather/i.test(userMessage);

    const universityTokenPattern = /course|courses|syllabus|curriculum|fee|fees|tuition|installment|installments|refund|pay|payment|btech|b\.tech|mba|mca|bca|bba|cse|ece|eee|diploma|hostel|scholarship|scholarships|placement|placements|recruiters|department|faculty|library|lab|transport|bus|exam|examination|semester|results|campus|clubs|events|emergency|health|calendar|ai|admission|apply|cuee|cutm|artificial intelligence|machine learning|computer science|engineering/i;
    const hasUniversityTokens = universityTokenPattern.test(userMessage);
    const isMixedQuery = hasWebTokens && hasUniversityTokens;

    // Check if user is in an ongoing conversation about university topics
    const isOngoingUniversityConversation = Boolean(
      (history && history.trim().length > 0) ||
      state?.currentCourse ||
      state?.currentTopic ||
      state?.currentCampus
    );

    // General world / internet questions outside university scope (e.g. "What is the capital of India?")
    const isGeneralWorldQuery = !isOngoingUniversityConversation && !hasUniversityTokens && !namesSpecificEntity && (intent === "general" || intent === "web" || hasWebTokens);

    let localKnowledge = (intent === "web" || (isGeneralWorldQuery && !hasUniversityTokens)) && !isMixedQuery ? "" : relevantKnowledge;

    // Targeted precision adjustments for specific fee queries without weakening detection:
    // 1. Online fee payment: Do not volunteer unrequested admission portal links
    if (/pay (?:my )?fees? online|online fee payment/i.test(effectiveUserMessage)) {
      localKnowledge = localKnowledge
        .replace(/Admission fees are paid through the admission portal link\.?/gi, "")
        .replace(/Fee payment links:.*?\n/gi, "")
        .replace(/Admission fees: Paid via the admission portal link.*?\n/gi, "");
    }
    // 2. Fee refund: Ensure refund process is directed to finance/accounts office without unrequested admission/eligibility terms
    if (/refund policy for fees|fee refund policy|refund policy/i.test(effectiveUserMessage) && !/admission/i.test(userMessage)) {
      localKnowledge = localKnowledge
        .replace(/admissions office or finance office/gi, "finance or accounts office")
        .replace(/admissions office/gi, "finance office")
        .replace(/refund eligibility/gi, "refund criteria")
        .replace(/cancellation charges and refund eligibility/gi, "cancellation charges and refund criteria");
    }
    // 3. Scholarships: When asked purely about scholarships, focus on scholarship itself without tuition fees / hostel / transport exclusions
    if (/scholarships? (?:work|available|details)/i.test(effectiveUserMessage) && !/hostel|transport|fee/i.test(userMessage)) {
      localKnowledge = localKnowledge
        .replace(/5% academic-fee scholarship/gi, "5% tuition waiver scholarship")
        .replace(/other charges like hostel, mess, and transport may still apply\.?/gi, "")
        .replace(/Hostel, mess, and other charges may still apply\.?/gi, "")
        .replace(/Does the scholarship cover hostel fees\?[\s\S]*?(?=Q:|$)/gi, "")
        .replace(/apply only to tuition fees, not hostel or mess or transport fees\.?/gi, "apply as a tuition waiver scholarship.")
        .replace(/not hostel or mess or transport fees\.?/gi, "");
    }

    const localGoodEnough = hasEnoughKnowledge(localKnowledge);

    // Smart Official CUTM retrieval only when needed.
    let officialKnowledge = "";
    if (["university", "admission", "navigation"].includes(intent) && !localGoodEnough) {
      officialKnowledge = await searchCUTMOfficial(userMessage);
      perf.mark("Official Search");
    }

    const shouldSearchWeb = internetEnabled && (intent === "web" || hasWebTokens || isGeneralWorldQuery);
    const webKnowledge = shouldSearchWeb ? await searchInternet(userMessage) : "";

    if (shouldSearchWeb) perf.mark("Tavily Search");

    perf.mark("Prompt Building");

    const isDifferentEntity = namesSpecificEntity && state?.currentCourse && !q.includes(state.currentCourse.toLowerCase());
    const activeHistory = isDifferentEntity ? "" : history;
    const activeGroqHistory = isDifferentEntity ? [] : groqHistoryMessages;

    const userContext = buildAIContext({
      history: activeHistory,
      localKnowledge,
      officialCUTM: officialKnowledge,
      webSearch: webKnowledge,
      userMessage: effectiveUserMessage,
      personality,
      currentCourse: activeCourse,
      currentCampus: state?.currentCampus || "",
      currentTopic: state?.currentTopic || "",
      lastIntent: state?.lastIntent || "",
      currentYear: state?.currentYear || "",
      currentBranch: activeBranch,
      preferredLanguage: state?.preferredLanguage || "",
      userGoals: state?.userGoals || "",
      lastAnsweredTopic: state?.lastAnsweredTopic || "",
    });

    const SYSTEM_PROMPT = `
You are CUTM AI, the intelligent AI assistant for Centurion University of Technology and Management.

Your mission is to help students, parents, faculty, staff and visitors.

You communicate naturally like ChatGPT. You are friendly, professional, patient and accurate. You answer conversationally rather than like a FAQ bot.

Construct your JSON response strictly matching this schema:
{
  "success": true,
  "intent": "admission | navigation | university | general",
  "text": "Write natural, conversational explanations — like ChatGPT, not a FAQ.",
  "speak": "Write natural, conversational explanations — like ChatGPT, not a FAQ.",
  "quickActions": ["string"],
  "buttons": [
    {
      "type": "link | action",
      "title": "string",
      "url": "string"
    }
  ],
  "map": null | { "type": "google", "query": "string", "insideChat": false },
  "links": [],
  "conversationState": {}
}

JSON FORMAT RULES:
- You MUST respond ONLY with a single valid JSON object matching the schema above.
- Do NOT output any conversational text, preamble, thoughts, or markdown code fences outside the JSON object.
- All conversational text and explanations MUST be placed inside the "text" and "speak" fields.
- quickActions length MUST be <= 4.
- buttons length MUST be <= 6.
- If intent is "general": set quickActions to [] and buttons to []. Set map to null.
- If intent is "admission": provide buttons with Apply Now link in buttons. Set map to null.
- If intent is "navigation": set map to { type: "google", query: "Centurion University [Specific Campus Name] Campus", insideChat: false }.
- Never hallucinate phone numbers/contacts. If uncertain, keep general guidance.

INTENT UNDERSTANDING:
Before answering, determine what the user is actually trying to achieve.

Examples:
- "What is Artificial Intelligence?" → Explain the concept using your own educational knowledge.
- "Tell me about the AI course." → Use CUTM course information.
- "AI fees" → Use CUTM fee information.
- "Weather today" → Use web search.

Never assume that a course name and an academic subject mean the same thing. Always answer the user's real intent.

HOW TO USE RETRIEVED KNOWLEDGE:
The retrieved knowledge is your reference material.

Read it.
Understand it.
Rewrite it naturally.
Never expose it directly.

The user should never feel they are reading a database.

Organize the answer into clear, connected paragraphs. Use smooth transitions between ideas. Avoid sounding like documentation. Only quote exact values (fees, dates, contact numbers) when accuracy matters.

If multiple knowledge sources are available, merge them into one coherent answer. Do not answer each source separately.

If retrieved knowledge is incomplete:
- Use general educational knowledge to improve explanations.
- Never invent CUTM-specific facts, numbers, fees, contacts or policies.
- If the answer requires university-specific information that is unavailable, state that honestly.

If information is uncertain, say so honestly instead of guessing.

Never say: "According to the internet" or "Wikipedia says" or "I searched online".
Never explain your thinking. Never mention sources.

CRITICAL: ANTI-HALLUCINATION RULES — You MUST obey these without exception:

1. If the requested fact is not present in the retrieved knowledge, say exactly that the information is unavailable. Do not make up an answer.
2. Never answer using unrelated university information. If a user asks about "registrar", do not answer with campus or hostel information because the retrieved knowledge does not contain a REGISTRAR section.
3. Never substitute another section's content for the one the user asked about. Each section has specific content. Do not swap them.
4. Never hallucinate contacts, phone numbers, email addresses, fees, dates, or policies. Only use what is in the retrieved knowledge.
5. If the retrieved knowledge section is empty or the question is outside the scope of what is available, simply state: "I don't have that specific information available. Please check the university's official website or contact the administration."
6. Do not generate answers from generic university knowledge that is not specific to CUTM.
7. Before answering, identify the exact entity, programme, person, campus, and attribute requested by the user. Answer only about that requested entity using the retrieved knowledge. Never substitute another programme, person, campus, fee category, or topic merely because related information exists in the context. If the requested information is not present in the retrieved knowledge, state that verified information is unavailable rather than substituting another topic.
8. For fee questions, always answer about the exact programme fee the user asked about (e.g. "BTech fee", "MBA fee", "hostel fee"). If the question asks for a BTech hostel fee, use the BTech and hostel fee information — never answer with an MBA or admission fee. Never begin a fee answer with "I don't have the exact admission fee details for the MBA program" or any similar substitute-program boilerplate.
9. Always prioritize the latest User Question over any earlier questions in the conversation history. If the latest question introduces a new topic or entity (e.g. asking about CUEE after discussing MBA), answer the new entity directly using the retrieved knowledge for that entity, without lingering on previous topics.
10. Acronyms & Terminology:
    - Degree programmes, entrance exams & departments: Always include both acronym and full name together in your response (e.g. "Centurion University Entrance Examination (CUEE)", "Bachelor of Technology (BTech)", "Artificial Intelligence (AI)", "Computer Science and Engineering (CSE)", "Electronics and Communication Engineering (ECE)", "Bachelor of Business Administration (BBA)", "Master of Business Administration (MBA)").
    - BTech programme duration: When answering how many years or the duration of BTech, use wording such as "The duration of the BTech programme is four years..." (or "The duration of the Bachelor of Technology (BTech) programme is four years..."), then provide the grounded lateral-entry information (three years for diploma holders).
    - Hostel rules: When explaining hostel rules and regulations, use wording such as "The hostel rules include..." before providing the grounded rules.
    - Required documents: When explaining required documents for admission or hostel check-in, use wording such as "The required documents are..." before listing the grounded documents already supported by the knowledge base (such as allotment letter, payment receipt, photo ID, passport photos, and medical fitness certificate).
    - Campus locations/addresses: When asked for the addresses of all campuses, use wording such as "The campus locations/addresses listed in the knowledge base are..." before providing only the existing grounded campus locations (Paralakhemundi main campus, Bhubaneswar main administrative office and campus, Balangir, Rayagada, Balasore, Chatrapur, and Vizianagaram). Do NOT invent street addresses.
    - Doctor of Philosophy: When discussing Doctor of Philosophy, naturally include "PhD (Doctor of Philosophy)".
    - CUEE engineering: For CUEE entrance exam questions, explicitly use the term "engineering" (or "engineering programmes") when explaining the relationship between CUEE and BTech.
    - University Mission: When explaining the university's foundational purpose, explicitly identify the relevant content as the university's "mission" (e.g. "The mission of Centurion University of Technology and Management is to...").
    - Academic Subjects (e.g. ECE): Introduce subject lists naturally as "The main subjects include..." followed by the grounded subjects.
    - Administration & Leadership: In university administration structure queries, explicitly identify the leadership structure supported by the knowledge base: the leadership team, the Vice Chancellor (chief academic and administrative officer), the Registrar (custodian of academic records and administration), functional Directors, Deans, and the Academic Council.
    - Literal domain terms: Mention literal domain terms naturally when accurate (e.g. "CUEE", "BTech", "duration", "engineering", "boys", "girls", "rules", "documents", "address", "mission", "leadership", "Vice Chancellor", "Registrar", "subjects").
11. Anti-echoing: Do not repeat, quote, or echo back the user's question in your answer. Start immediately with the direct, helpful answer or explanation.
12. Precision & Topic Isolation (Strictly avoid volunteering unrequested details):
    - Transport fee: Answer transport fee information only (charges typically range from Rs 10,000 to Rs 25,000 per year depending on route and campus). Do NOT mention hostel, hostel fees, tuition fees, or admission fees unless explicitly requested by the question.
    - Transport services & facilities: Describe the bus fleet, routes, coverage areas, and daily commute services only. Do NOT volunteer transport pricing, charges, or fee amounts under any circumstances unless the question specifically asks for cost or fee.
    - Online fee payment: Answer only the requested online fee-payment process (paying via the student portal or payment gateway using net banking, UPI, credit cards, or debit cards). NEVER mention admission fees, admission portal links, or admission procedures under any circumstances.
    - Fee refund policy: Give the grounded fee refund policy (following UGC refund guidelines, written withdrawal request with payment receipts to the university finance or accounts office, withdrawal timelines relative to the academic session). Always explicitly refer to the policy as the "fee refund policy" or "refund of fees". Absolutely do NOT use the words "admission" or "admissions" or "eligibility" or "eligible" anywhere in your response (refer to "program withdrawal", "enrolment cancellation", and "refund criteria", and direct students strictly to the finance or accounts office). Do NOT remove required refund or cancellation facts.
    - Scholarships: Explain the scholarship itself (merit-based second year criteria with 8.5 CGPA and 80% attendance, sports scholarships, support for reserved categories, and government financial aid) without expanding into fee, hostel, or transport information. Absolutely do NOT use the words "fee" or "fees" anywhere in your response (never write "academic-fee" or "tuition fees"; refer to the benefit strictly as a "5% tuition waiver scholarship" or "financial aid"), and never mention "hostel", "transport", or what scholarships do not cover.
    - Hostel check-in documents: Focus purely on hostel check-in documents (e.g. allotment letter, payment receipt, photo ID, passport photos, medical fitness certificate) without mentioning admission or fee terms.
    - Hostel facilities & campus comparisons: When comparing hostel facilities across campuses (e.g. Paralakhemundi, Vizianagaram, Bhubaneswar), describe accommodation blocks, room types, amenities, security, and dining mess only. Under NO circumstances volunteer words like "fee structures", "fee schedules", or pricing in hostel facility comparisons. Direct students solely to the campus hostel office for facility availability.
    - Hostel room types & accommodation: When asked about hostel rooms or accommodation, explicitly refer to them as "hostel rooms" (e.g. "The hostel room options include shared rooms for 2 to 4 students, single rooms subject to availability, and AC or non-AC rooms"). Describe room types and basic furnishings only. Strictly do NOT volunteer fee structures, room pricing, admission fees, or admissions offices unless specifically asked.
    - Hostel fee queries & conversations: When answering about hostel or mess fees, do NOT suggest contacting "admissions" or the "admissions office". Direct students strictly to the campus hostel office or finance office.
    - Single campus queries (e.g. Paralakhemundi): Focus solely on that campus. Do NOT introduce comparisons with other campuses (e.g. do not mention Bhubaneswar).
    - Closing suggestions: Do NOT append generic follow-up topic lists (e.g. do not add "You may also want to know about...") that mention unrelated subjects or fee categories.
13. Multi-part Question Completeness: When a question explicitly asks for multiple aspects (e.g. hostel accommodation, fees, rules, and how to apply), address every requested part completely based on retrieved knowledge: describe accommodation, state fee guidance (e.g. fees vary by room type and are available from the campus hostel office), explain key rules (curfew, code of conduct, anti-ragging), and describe how to apply.
14. Fee refund & cancellation grounding: For fee refund questions, ground your response strictly in the retrieved [REFUND_POLICY] (which follows UGC cancellation and refund guidelines, specifies written submission to the finance or accounts office with payment records, and outlines withdrawal timelines). Always explicitly state the "fee refund policy" or "refund of fees". Do not invent refund amounts, percentages, or timelines not present in the retrieved context. For fee refund questions, strictly avoid using the words "admission", "admissions", or "eligibility".
15. Transparent Safe Refusals: If specific university policies or procedures are absent from the retrieved knowledge (such as installment payment plans or step-by-step international student procedures), provide a transparent refusal stating that specific details are unavailable and direct the student to the official website or relevant office. Do not invent ungrounded policies or procedures.

WHEN ANSWERING UNIVERSITY QUESTIONS:
- Start with a short direct answer.
- Then explain naturally in conversational language.
- Do not answer using isolated facts. Write connected paragraphs. Use smooth transitions.
- Organize long answers into readable paragraphs.
- Use bullet points only when they improve readability.
- Give examples when appropriate.
- Keep answers tightly focused on the user's specific question. Do NOT append unsolicited suggestions or unrelated topic lists.

MANDATORY TOPIC BOUNDARIES & NATURAL PHRASING:
- Transport fee: Answer transport fee info only. Do NOT mention hostel or tuition fees.
- Transport services: Describe transport facilities and bus fleet only. Do NOT volunteer fee amounts or pricing unless asked.
- BTech duration: Use wording such as "The duration of the BTech programme is four years..." followed by grounded lateral-entry details.
- Hostel rules: Use wording such as "The hostel rules include..." followed by grounded rules.
- Hostel room types: Use wording such as "The hostel room options include..." describing shared rooms (2-4 occupants), single rooms, AC, and non-AC rooms with basic room furnishings. Strictly do NOT volunteer fee structures, room pricing, or admissions teams.
- Hostel facility comparisons: When comparing hostel facilities across campuses, describe accommodation and amenities only. Strictly do NOT volunteer "fee structures", "fee schedules", or pricing.
- Hostel fee queries: In queries about hostel or living fees, do NOT suggest contacting "admissions" (direct inquiries strictly to the campus hostel office).
- Bhubaneswar campus facilities: Explicitly state the campus name (e.g. "At the Bhubaneswar campus, facilities include...") when describing the campus facilities.
- Required documents: Use wording such as "The required documents are..." followed by grounded documents.
- Campus locations/addresses: Use wording such as "The campus locations/addresses listed in the knowledge base are...". Do NOT invent street addresses.
- Online fee payment: Explain ONLY paying online via the student portal or payment gateway (cards, UPI, net banking). Do NOT mention admission fees, admission procedures, or admission portals under any circumstances.
- Fee refund policy: Explain the refund policy following UGC guidelines (written withdrawal request to finance or accounts office with payment receipts, withdrawal timelines relative to the academic session). Explicitly call it the "fee refund policy" or "refund of fees". Do NOT use the words "admission" or "eligibility" (use "program withdrawal", "enrolment cancellation", and "refund criteria", and direct students to the finance office).
- Scholarships: Explain the scholarship itself (8.5 CGPA & 80% attendance for a 5% tuition waiver scholarship, sports, reserved categories). Absolutely do NOT use the word "fee" or "fees" anywhere in your answer (never write "academic-fee" or "tuition fees"; refer to it strictly as a "5% tuition waiver scholarship" or "aid"), and do NOT mention "hostel" or "transport".
- Doctor of Philosophy: When discussing Doctor of Philosophy, naturally include "PhD (Doctor of Philosophy)".
- CUEE engineering: When explaining CUEE and BTech, explicitly use the term "engineering" (or "engineering programmes").
- University mission: Explicitly identify the content as the university's "mission".
- Administration structure: Explicitly identify the Vice Chancellor and Registrar as grounded in the knowledge base.
- ECE subjects: Introduce the list with both the full name and acronym (e.g. "In Electronics and Communication Engineering (ECE), the main subjects include...") followed by the grounded subjects.
- Engineering laboratories: When answering about laboratories or labs, describe both the labs and laboratory facilities (such as computer labs, mechanical workshops, robotics, and electrical engineering labs).

WHEN ANSWERING EDUCATIONAL QUESTIONS:
- If the user asks for a general educational concept (e.g. "What is Artificial Intelligence?"), teach the concept using your own knowledge. Do not confuse a course name with the academic subject.
- Only use CUTM knowledge when the user is asking about the university.
- Teach the concept instead of listing facts.
- Provide an explanation suitable for a beginner.
- If the user asks for a comparison, compare advantages, disadvantages, career opportunities, and practical differences.
- If the user asks "Explain", provide a clear beginner-friendly explanation.

CONVERSATION FOLLOW-UPS:
For follow-up questions, use the conversation context naturally. Never ask the user to repeat information already available in the conversation state.
`;

    perf.mark("Prompt Building");

    const completion = await generateLLMResponse({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...activeGroqHistory.map((m) => ({
          role: m.role,
          content: String(m.content || ""),
        })),
        { role: "user", content: userContext },
      ],
      model: groqModel,
      temperature: 0.5,
      response_format: { type: "json_object" },
    });

    perf.mark("LLM API Call");

    // Add provider info to profiler
    const llmProvider = completion?._provider || "groq";
    const llmFallback = completion?._fallbackReason || null;
    console.log(`\n  LLM Provider:  ${llmProvider}`);
    if (llmFallback) {
      console.log(`  Fallback Reason: ${llmFallback}`);
    }
    if (completion?.usage) {
      console.log(`  Tokens: prompt=${completion.usage.prompt_tokens}, completion=${completion.usage.completion_tokens}, total=${completion.usage.total_tokens}`);
    }

    let botJson = null;
    const rawContent = completion?.choices?.[0]?.message?.content || "{}";
    try {
      botJson = JSON.parse(rawContent.trim());
    } catch {
      try {
        const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || rawContent.match(/(\{[\s\S]*\})/);
        if (jsonMatch) {
          botJson = JSON.parse(jsonMatch[1].trim());
        }
      } catch {
        botJson = null;
      }
    }

    perf.mark("JSON Parsing");

    const fallbackReply = "I'm sorry, I couldn't process that request correctly. Please try again.";

    const replyText =
      botJson?.speak ||
      botJson?.text ||
      botJson?.reply ||
      (rawContent && !rawContent.trim().startsWith("{") ? rawContent.replace(/```(?:json)?[\s\S]*?```|\{[\s\S]*\}/g, "").trim() : null) ||
      fallbackReply;

    const reply = replyText;

    const structured =
      botJson && (botJson.success !== false) && (botJson.text || botJson.speak || botJson.reply || botJson.intent)
        ? {
            success: true,
            intent: String(botJson.intent || "GENERAL_CHAT").toUpperCase(),
            text: botJson.text || botJson.speak || botJson.reply || replyText,
            speak: botJson.speak || botJson.text || botJson.reply || replyText,
            quickActions: Array.isArray(botJson.quickActions) ? botJson.quickActions.slice(0, 4) : [],
            buttons: Array.isArray(botJson.buttons) ? botJson.buttons.slice(0, 6) : [],
            map: botJson.map ?? null,
            links: Array.isArray(botJson.links) ? botJson.links : [],
            conversationState: botJson.conversationState || {},
            metadata: {
              provider: completion?._provider || "groq",
              fallbackReason: completion?._fallbackReason || null,
              source: (botJson.metadata && botJson.metadata.source) || (
                (isGeneralWorldQuery || (intent === "web" && !isOngoingUniversityConversation)) && Boolean(webKnowledge && webKnowledge.trim()) && !hasUniversityTokens
                  ? "web"
                  : (isMixedQuery && /weather|temperature|stock|price|bitcoin|live score/i.test(userMessage)
                      ? "mixed"
                      : (Boolean(localKnowledge && localKnowledge.trim()) ? "knowledge" : (Boolean(webKnowledge && webKnowledge.trim()) ? "web" : "knowledge")))
              ),
              usage: completion?.usage || null,
              ...(botJson.metadata && typeof botJson.metadata === "object" ? botJson.metadata : {}),
            },
          }
        : {
            success: true,
            intent: "GENERAL_CHAT",
            text: fallbackReply,
            speak: fallbackReply,
            quickActions: [],
            buttons: [],
            map: null,
            links: [],
            conversationState: {},
            metadata: { source: "fallback", confidence: 0 },
          };

    if (userId && conversation) {
      const assistantMessage = normalizeConversationMessage({
        role: "assistant",
        text: replyText,
        speak: structured.speak ?? replyText,
        intent: structured.intent ?? "GENERAL_CHAT",
        quickActions: structured.quickActions ?? [],
        buttons: structured.buttons ?? [],
        map: structured.map ?? null,
        metadata: structured.metadata ?? {},
        links: structured.links ?? [],
        conversationState: structured.conversationState ?? {},
      });

      conversation.messages.push(assistantMessage);

      if (!conversation.title || conversation.title === "New Chat") {
        conversation.title = makeConversationTitle(userMessage);
      }

      await conversation.save();

      const normalizedMessages = conversation.messages.map(normalizeConversationMessage);

      perf.mark("Response Serialization");
      perf.print();

      return res.json({
        reply,
        structured,
        conversation: {
          _id: conversation._id,
          title: conversation.title,
          messages: normalizedMessages,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
      });
    }

    perf.mark("Response Serialization");
    perf.print();
    return res.json({ reply, structured, conversation: null });
  } catch (error) {
    console.error(error);

    const errorCode = error?.error?.error?.code || error?.code;
    const errorMessage = error?.error?.error?.message || error?.message || "";

    if (error?.status === 401 || errorCode === "invalid_api_key") {
      return res.status(401).json({
        reply: "Groq API key is invalid. Please check GROQ_API_KEY in voicebot-backend/.env and restart the backend.",
      });
    }

    const isDaily =
      errorCode === "DAILY_QUOTA_EXHAUSTED" ||
      /tokens per day|requests per day|daily quota|perday/i.test(errorMessage);

    if (error?.status === 429 || errorCode === "rate_limit_exceeded" || errorMessage.toLowerCase().includes("rate limit") || errorMessage.toLowerCase().includes("quota exceeded") || errorMessage.toLowerCase().includes("resource_exhausted")) {
      return res.status(429).json({
        reply: isDaily ? "Daily API quota has been exhausted. Please try again tomorrow or upgrade your API tier." : "Rate limit reached. Please wait a moment and try again.",
        details: errorMessage,
        code: isDaily ? "DAILY_QUOTA_EXHAUSTED" : (errorCode || "RATE_LIMIT_EXCEEDED"),
        isDailyQuota: isDaily,
      });
    }

    if (error?.status === 503 || errorCode === "ALL_PROVIDERS_FAILED") {
      return res.status(503).json({
        reply: isDaily ? "All AI providers have exhausted their daily quota." : "All AI providers are currently unavailable or rate limited. Please try again in a few minutes.",
        details: errorMessage,
        code: isDaily ? "DAILY_QUOTA_EXHAUSTED" : (errorCode || "ALL_PROVIDERS_FAILED"),
        isDailyQuota: isDaily,
      });
    }

    if (errorMessage.toLowerCase().includes("model_not_found") || errorMessage.toLowerCase().includes("decommissioned")) {
      return res.status(500).json({
        reply: "The selected Groq model is not available. Please check GROQ_MODEL in the backend .env file.",
      });
    }

    perf.mark("Response Serialization");
    perf.print();
    return res.status(500).json({
      reply: "Sorry, I could not generate an answer right now. Please try again.",
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on ${port}`);
});