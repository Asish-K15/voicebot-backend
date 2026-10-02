export function buildAIContext({
  history = "",
  localKnowledge = "",
  officialCUTM = "",
  webSearch = "",
  userMessage = "",
  personality = "Friendly",
  currentCourse = "",
  currentCampus = "",
  currentTopic = "",
  lastIntent = "",
  currentYear = "",
  currentBranch = "",
  preferredLanguage = "",
  userGoals = "",
  lastAnsweredTopic = "",
} = {}) {
  const blocks = [];

  if (officialCUTM && officialCUTM.trim()) {
    blocks.push(`===== OFFICIAL CUTM WEBSITE =====\n${officialCUTM.trim()}`);
  }

  if (localKnowledge && localKnowledge.trim()) {
    blocks.push(`===== LOCAL UNIVERSITY KNOWLEDGE =====\n${localKnowledge.trim()}`);
  }

  if (webSearch && webSearch.trim()) {
    blocks.push(`===== WEB SEARCH (Tavily) =====\n${webSearch.trim()}`);
  }

  const context = blocks.length ? blocks.join("\n\n") : "";

  let conversationContext = "";
  if (currentCourse || currentCampus || currentTopic || lastIntent || currentYear || currentBranch || preferredLanguage || userGoals || lastAnsweredTopic) {
    const parts = [];
    if (currentCourse) parts.push(`Current Course: ${currentCourse}`);
    if (currentCampus) parts.push(`Current Campus: ${currentCampus}`);
    if (currentTopic) parts.push(`Current Topic: ${currentTopic}`);
    if (lastIntent) parts.push(`Last Intent: ${lastIntent}`);
    if (currentYear) parts.push(`Current Year: ${currentYear}`);
    if (currentBranch) parts.push(`Current Branch: ${currentBranch}`);
    if (preferredLanguage) parts.push(`Preferred Language: ${preferredLanguage}`);
    if (userGoals) parts.push(`User Goals: ${userGoals}`);
    if (lastAnsweredTopic) parts.push(`Last Answered Topic: ${lastAnsweredTopic}`);
    conversationContext = `\n===== CONVERSATION CONTEXT =====\n${parts.join("\n")}`;
  }

  return `
Conversation History:
${history}${conversationContext}

Retrieved Knowledge:
${context}

User Question:
${userMessage}
`;
}