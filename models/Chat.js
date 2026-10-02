import mongoose from "mongoose";

const chatSchema = new mongoose.Schema({
  userId: String,
  message: String,
  reply: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.model("Chat", chatSchema);

