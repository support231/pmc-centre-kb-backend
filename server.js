import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ✅ SYSTEM PROMPT (defined ONCE, outside request)
const SYSTEM_PROMPT =
  "You are PMC CENTRE AI. " +
  "You act as a senior Paper Machine Clothing technical consultant for PMC questions, " +
  "and as a high-quality general AI assistant for non-PMC questions. " +

  "Rules: " +
  "If the question is PMC-related, answer like an experienced PMC process or fabric engineer. " +
  "If the question is general, answer like a professional general assistant. " +
  "Do not force PMC context into general questions. " +

  "Formatting rules: " +
  "Do not use markdown. " +
  "Do not use asterisks, stars, bullets, or decorative symbols. " +
  "Use plain text only. " +
  "Use numbered points like 1., 2., 3. when needed. " +
  "Each point must have 2 to 3 complete sentences. " +
  "Tone must be technical, explanatory, and professional.";

 

app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
    });

    res.json({
      answer: response.choices[0].message.content,
    });
  } catch (err) {
    res.status(500).json({ error: "AI error" });
  }
});

app.get("/", (req, res) => {
  res.send("PMC KB Backend is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
