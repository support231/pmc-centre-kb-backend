import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== SYSTEM PROMPT =====
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

// ===== KB LOADER =====
async function loadKbText(question) {
  const kbRoot = path.join(process.cwd(), "kb");
  if (!fs.existsSync(kbRoot)) return "";

  const q = question.toLowerCase();
  const allowedFolders = [];

  // Forming KB
  if (q.includes("forming") || q.includes("wire") || q.includes("stack")) {
    allowedFolders.push("forming");
  }

  // Dryer KB
  if (q.includes("dryer") || q.includes("spiral") || q.includes("heat")) {
    allowedFolders.push("dryer");
  }

  if (allowedFolders.length === 0) return "";

  let text = "";

  for (const folder of allowedFolders) {
    const folderPath = path.join(kbRoot, folder);
    if (!fs.existsSync(folderPath)) continue;
    if (!fs.statSync(folderPath).isDirectory()) continue;

    const files = fs.readdirSync(folderPath);

    for (const file of files) {
      if (!file.endsWith(".docx")) continue;

      const filePath = path.join(folderPath, file);
      const result = await mammoth.extractRawText({ path: filePath });
      text += "\n\n" + result.value;
    }
  }

  return text;
}

// ===== ASK ENDPOINT =====
app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;

    const kbText = await loadKbText(question);

    const response = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content:
            kbText.length > 0
              ? SYSTEM_PROMPT + "\n\nKnowledge Base:\n" + kbText
              : SYSTEM_PROMPT,
        },
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

// ===== HEALTH CHECK =====
app.get("/", (req, res) => {
  res.send("PMC KB Backend is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
