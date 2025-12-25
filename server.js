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

/* ===============================
   SYSTEM PROMPTS
   =============================== */

/* ---------- KB MODE (STRICT, INTERNAL) ---------- */
const KB_SYSTEM_PROMPT = `
You are PMC CENTRE AI operating in STRICT KNOWLEDGE BASE MODE.

Rules:
Use ONLY the information provided in the Knowledge Base below.
Do NOT add explanations, interpretations, examples, or mechanisms not explicitly written in the Knowledge Base.
Do NOT rephrase or simplify technical definitions.
Preserve terminology exactly as written.
If the answer is not explicitly present in the Knowledge Base, reply exactly:
"This information is not defined in the PMC CENTRE Knowledge Base."

Formatting rules:
Plain text only.
No markdown, no bullets, no symbols.
Use numbered points only if the Knowledge Base uses them.
Tone must be technical and neutral.
`;

/* ---------- MODEL MODE (MAIN USER EXPERIENCE) ---------- */
const MODEL_SYSTEM_PROMPT = `
You are PMC CENTRE AI.
You act as a senior Paper Machine Clothing technical consultant for PMC questions,
and as a high-quality general AI assistant for non-PMC questions.

Rules:
If the question is PMC-related, answer like an experienced PMC process or fabric engineer.
If the question is general, answer like a professional general assistant.
Do not force PMC context into general questions.

Formatting rules:
Plain text only.
No markdown or decorative symbols.
Use numbered points when helpful.
Tone must be technical, explanatory, and professional.
`;

/* ===============================
   PMC QUESTION DETECTOR
   =============================== */

function isPmcQuestion(question) {
  const q = question.toLowerCase();

  const pmcKeywords = [
    // Paper machine / paper
    "paper machine",
    "paper mill",
    "papermaking",
    "papermaking",
    "stock preparation",
    "forming section",
    "press section",
    "dryer section",

    // Paper Machine Clothing
    "forming fabric",
    "dryer fabric",
    "press fabric",
    "wire",
    "felt",
    "fabric",

    // Fabric constructions & terms
    "ssb",
    "double layer",
    "triple layer",
    "1.5 layer",
    "multilayer",
    "multi layer",
    "ps warp",
    "ms warp",
    "warp",
    "weft",
    "stacking",
    "weft stacking",
    "warp stacking",

    // Dryer / heat
    "dryer",
    "spiral",
    "heat",
    "temperature",
    "shrinkage",
    "heat setting"
  ];

  return pmcKeywords.some(keyword => q.includes(keyword));
}

/* ===============================
   KB LOADER
   =============================== */

async function loadKbText(question) {
  const kbRoot = path.join(process.cwd(), "kb");
  if (!fs.existsSync(kbRoot)) return "";

  const q = question.toLowerCase();
  const allowedFolders = [];

  // Forming KB
  if (
    q.includes("forming") ||
    q.includes("wire") ||
    q.includes("stack") ||
    q.includes("ssb") ||
    q.includes("warp") ||
    q.includes("weft")
  ) {
    allowedFolders.push("forming");
  }

  // Dryer KB
  if (
    q.includes("dryer") ||
    q.includes("spiral") ||
    q.includes("heat") ||
    q.includes("shrink")
  ) {
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

  return text.trim();
}

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Invalid question" });
    }

    const pmcRelated = isPmcQuestion(question);
    const kbText = pmcRelated ? await loadKbText(question) : "";

    const systemPrompt =
      pmcRelated && kbText.length > 0
        ? KB_SYSTEM_PROMPT + "\n\nKnowledge Base:\n" + kbText
        : MODEL_SYSTEM_PROMPT;

    const response = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    });

    res.json({
      answer: response.choices[0].message.content,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI error" });
  }
});

/* ===============================
   HEALTH CHECK
   =============================== */

app.get("/", (req, res) => {
  res.send("PMC KB Backend is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
