import express from "express";
import auth from "../middleware/auth.js";
import User from "../models/User.js";
import Conversation from "../models/Conversation.js";

const router = express.Router();

router.get("/profile", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const totalConversations = await Conversation.countDocuments({
      userId: req.user.id,
    });

    const userData = user.toObject();

    res.json({
      ...userData,
      createdAt: userData.createdAt || user._id.getTimestamp(),
      totalConversations,
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error" });
  }
});

export default router;

