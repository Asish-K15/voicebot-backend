// In-memory per-user conversation state.
// Note: This is Phase 2.3 per your request (no DB / schema changes).

const memory = new Map();

// 30 minutes inactivity timeout
const INACTIVITY_MS = 30 * 60 * 1000;

function getConversation(userId) {
  const now = Date.now();

  if (!memory.has(userId)) {
    memory.set(userId, {
      currentCourse: null,
      currentCampus: null,
      currentTopic: null,
      lastIntent: null,
      currentYear: null,
      currentBranch: null,
      preferredLanguage: null,
      userGoals: null,
      lastAnsweredTopic: null,
      lastActiveAt: now,
    });
  }

  const state = memory.get(userId);
  // timeout handling
  if (state?.lastActiveAt && now - state.lastActiveAt > INACTIVITY_MS) {
    memory.delete(userId);
    memory.set(userId, {
      currentCourse: null,
      currentCampus: null,
      currentTopic: null,
      lastIntent: null,
      currentYear: null,
      currentBranch: null,
      preferredLanguage: null,
      userGoals: null,
      lastAnsweredTopic: null,
      lastActiveAt: now,
    });
    return memory.get(userId);
  }

  state.lastActiveAt = now;
  return state;
}

function updateConversation(userId, updates = {}) {
  const state = getConversation(userId);
  Object.assign(state, updates);
  state.lastActiveAt = Date.now();
  memory.set(userId, state);
  return state;
}

function clearConversation(userId) {
  memory.delete(userId);
}

export { getConversation, updateConversation, clearConversation };

