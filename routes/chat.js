import express from "express";
import optionalAuth from "../middleware/optionalAuth.js";
import auth from "../middleware/auth.js";
import Conversation from "../models/Conversation.js";

const router = express.Router();

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

// Keep any existing history endpoint protected
router.get("/history", auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user.id })
      .sort({ updatedAt: -1 })
      .select("title messages createdAt updatedAt")
      .lean();

    const normalized = conversations.map((conversation) => ({
      ...conversation,
      messages: (conversation.messages || []).map(normalizeConversationMessage),
    }));

    res.json(normalized);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

// Note: POST /chat is implemented in server.js in this repo.
// This file exports only the protected history route.

export default router;


