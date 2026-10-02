// Groq API wrapper — thin wrapper around groq-sdk
import Groq from "groq-sdk";

let groqClient = null;

function getClient() {
  if (!groqClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error("GROQ_API_KEY is not set"), { code: "MISSING_KEY" });
    }
    groqClient = new Groq({ apiKey });
  }
  return groqClient;
}

export async function createGroqCompletion({ messages, model, temperature, response_format }) {
  const client = getClient();

  try {
    const completion = await client.chat.completions.create({
      messages,
      model: model || process.env.GROQ_MODEL,
      temperature: temperature ?? 0.5,
      response_format: response_format || { type: "json_object" },
    });

    return completion;
  } catch (error) {
    // Preserve status codes from Groq SDK errors
    const err = new Error(error?.error?.error?.message || error.message || "Groq API error");
    err.status = error?.status || 500;
    err.code = error?.error?.error?.code || error?.code || "GROQ_ERROR";
    throw err;
  }
}