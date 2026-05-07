import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
  res.send('Voicebot backend is running');
});

app.post('/chat', async (req, res) => {
  const userMessage = String(req.body.message || '').trim();

  if (!userMessage) {
    return res.status(400).json({ reply: 'Please send a message.' });
  }

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
    return res.status(503).json({ reply: 'OPENAI_API_KEY is not configured on the backend.' });
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a voice assistant for Centurion University, GT, GTAM, and Tarang. Answer clearly and shortly.',
          },
          {
            role: 'user',
            content: userMessage,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const reply = response.data.choices?.[0]?.message?.content || 'I could not generate a reply.';
    res.json({ reply });
  } catch (error) {
    console.error('AI error:', error.response?.data || error.message);
    res.status(500).json({ reply: 'Error from AI' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
