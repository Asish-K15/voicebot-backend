import express from "express";
import auth from "../middleware/auth.js";
import Conversation from "../models/Conversation.js";

const router = express.Router();

function makeTitleFromText(text) {
  const title = (text || "").trim().replace(/\s+/g, " ");
  if (!title) return "New Chat";
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
}

router.post("/", auth, async (req, res) => {
  try {
    const { title, messages = [] } = req.body || {};
    const safeMessages = Array.isArray(messages)
      ? messages
          .filter((message) => ["user", "assistant"].includes(message?.role))
          .map((message) => ({
            role: message.role,
            text: String(message.text || ""),
          }))
          .filter((message) => message.text.trim())
      : [];

    const firstUserMessage = safeMessages.find((message) => message.role === "user");
    const conversation = await Conversation.create({
      userId: req.user.id,
      title: title || makeTitleFromText(firstUserMessage?.text),
      messages: safeMessages,
    });

    res.status(201).json(conversation);
  } catch (err) {
    console.error("Create conversation failed:", err?.message || err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.get("/", auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user.id })
      .sort({ updatedAt: -1 })
      .select("title messages createdAt updatedAt")
      .lean();

    res.json(
      conversations.map((conversation) => ({
        _id: conversation._id,
        title:
          conversation.title ||
          makeTitleFromText(
            conversation.messages?.find((message) => message.role === "user")?.text
          ),
        messageCount: conversation.messages?.length || 0,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      }))
    );
  } catch (err) {
    console.error("List conversations failed:", err?.message || err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    res.json(conversation);
  } catch (err) {
    console.error("Get conversation failed:", err?.message || err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.patch("/:id", auth, async (req, res) => {
  try {
    const updates = {};

    if (typeof req.body?.title === "string") {
      updates.title = req.body.title.trim() || "New Chat";
    }

    if (Array.isArray(req.body?.messages)) {
      updates.messages = req.body.messages
        .filter((message) => ["user", "assistant"].includes(message?.role))
        .map((message) => ({
          role: message.role,
          text: String(message.text || ""),
        }))
        .filter((message) => message.text.trim());
    }

    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    res.json(conversation);
  } catch (err) {
    console.error("Update conversation failed:", err?.message || err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.delete("/", auth, async (req, res) => {
  try {
    const result = await Conversation.deleteMany({ userId: req.user.id });
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error("Clear conversations failed:", err?.message || err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const result = await Conversation.deleteOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    if (!result.deletedCount) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Delete conversation failed:", err?.message || err);
    res.status(500).json({ message: "Server Error" });
  }
});

export default router;
