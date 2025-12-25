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
   PROMPTS
   =============================== */

// ---- INTENT DETECTION PROMPT (VERY SMALL) ----
const INTENT_PROMPT = `
Classify the user question.

Is this question related to Paper Machine Clothing, papermaking, paper machine sections,
or paper industry engineering?

Answer with ONE WORD only:
PMC
or
GENERAL
`;

// ---- KB MODE PROMPT (STRICT) ----
const KB_SYSTEM_PROMPT = `
You are PMC CENTRE AI operating in STRICT KNOWLEDGE BASE MODE.

Rules:
Use ONLY the information provided in the Knowledge Base below.
Do NOT add explanations or interpretations not explicitly present.
Preserve terminology exactly as written.

Formatting rules:
Plain text only.
No markdown or symbols.
Tone must be technical and neutral.
`;

// ---- PMC MODEL MODE (WHEN KB IS NOT SUFFICIENT) ----
const PMC_MODEL_PROMPT = `
You are PMC CENTRE AI.
You are a senior Paper Machine Clothing technology consultant with decades of industry experience.

Rules:
Answer using established PMC engineering knowledge and industry practice.
Be unbiased and technical.
If the Knowledge Base does not contain this information, clearly state that
it is not yet available in the PMC CENTRE archive.

End the answer with:
"For detailed mill-specific guidance, please contact PMC CENTRE experts at support@pmccentre.com."

Formatting rules:
Plain text only.
No markdown.
Professional tone.
`;

// ---- GENERAL MODEL MODE ----
const GENERAL_MODEL_PROMPT = `
You are PMC CENTRE AI.
You are a high-quality general AI assistant.

Rules:
Answer clearly and professionally.
No PMC context unless required.

Formatting rules:
Plain text only.
No markdown.
`;

/* ===============================
   KB LOADER
   =============================== */

async function loadKbText(question) {
  const kbRoot = path.join(process.cwd(), "kb");
  if (!fs.existsSync(kbRoot)) return "";

  const q = question.toLowerCase();
  const allowedFolders = [];

  if (
    q.includes("forming") ||
    q.includes("wire") ||
    q.includes("stack") ||
    q.includes("warp") ||
    q.includes("weft") ||
    q.includes("ssb")
  ) {
    allowedFolders.push("forming");
  }

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

    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      if (!file.endsWith(".docx")) continue;
      const result = await mammoth.extractRawText({
        path: path.join(folderPath, file),
      });
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
    if (!question) return res.status(400).json({ error: "Invalid question" });

    /* ---- CALL 1: INTENT DETECTION ---- */
    const intentResult = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: INTENT_PROMPT },
        { role: "user", content: question },
      ],
      max_tokens: 5,
    });

    const intent =
      intentResult.choices[0].message.content.trim().toUpperCase();

    /* ---- CALL 2: ANSWER ---- */

    let systemPrompt = GENERAL_MODEL_PROMPT;
    let kbText = "";

    if (intent === "PMC") {
      kbText = await loadKbText(question);

      if (kbText.length > 0) {
        systemPrompt =
          KB_SYSTEM_PROMPT + "\n\nKnowledge Base:\n" + kbText;
      } else {
        systemPrompt = PMC_MODEL_PROMPT;
      }
    }

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
