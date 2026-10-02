import express from "express";
import auth from "../middleware/auth.js";
import Conversation from "../models/Conversation.js";

const router = express.Router();

function makeTitleFromFirstUserMessage(text) {
  const t = (text || "").trim();
  if (!t) return "New Chat";
  // Keep it short for sidebar.
  return t.length > 40 ? `${t.slice(0, 40)}...` : t;
}

router.post("/", auth, async (req, res) => {
  try {
    const { title, firstMessage } = req.body || {};

    const conversation = await Conversation.create({
      userId: String(req.user.id),
      title: title || "New Chat",
      messages: firstMessage
        ? [
            {
              role: "user",
              text: firstMessage,
            },
          ]
        : [],
    });

    res.json({ conversationId: conversation._id });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.get("/", auth, async (req, res) => {
  try {
    const conversations = await Conversation.find({
      userId: req.user.id,
    })
      .sort({ updatedAt: -1 })
      .select("title createdAt updatedAt messages")
      .lean();

    const items = conversations.map((c) => {
      const first = c.messages?.find((m) => m.role === "user");
      const questionPreview = first?.text || "";

      return {
        _id: c._id,
        title: c.title || makeTitleFromFirstUserMessage(questionPreview),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
      };
    });

    res.json(items);
  } catch (err) {
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
    res.status(500).json({ message: "Server Error" });
  }
});

router.patch("/:id", auth, async (req, res) => {
  try {
    const { title } = req.body || {};

    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      {
        $set: {
          title: (title || "").trim() || "New Chat",
        },
      },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    res.json(conversation);
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.delete("/", auth, async (req, res) => {
  try {
    const result = await Conversation.deleteMany({ userId: req.user.id });
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const result = await Conversation.deleteOne({
      _id: req.params.id,
      userId: req.user.id,
    });

    res.json({ ok: result.deletedCount === 1 });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

export default router;


