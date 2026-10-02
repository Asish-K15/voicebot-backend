import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    speak: {
      type: String,
      default: "",
    },
    intent: {
      type: String,
      default: "GENERAL_CHAT",
    },
    quickActions: {
      type: [String],
      default: [],
    },
    buttons: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    map: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    links: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    conversationState: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      default: "New Chat",
      trim: true,
      index: true,
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
  },
  { timestamps: true }
);

export default mongoose.model("Conversation", conversationSchema);

