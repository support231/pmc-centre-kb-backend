import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

/* ===============================
   OPENAI CLIENT
   =============================== */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ===============================
   KB CONFIG
   =============================== */

const KB_ROOT = path.join(process.cwd(), "KB");
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const TOP_K = 5;

let kbChunks = [];

/* ===============================
   KB LOAD & EMBED
   =============================== */

function scanKB(dir, files = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) scanKB(full, files);
    else files.push(full);
  }
  return files;
}

async function extractText(file) {
  if (file.endsWith(".docx")) {
    const r = await mammoth.extractRawText({ path: file });
    return r.value || "";
  }
  if (file.endsWith(".pdf")) {
    const r = await pdfParse(fs.readFileSync(file));
    return r.text || "";
  }
  return "";
}

function chunkText(text) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const c = text.slice(i, i + CHUNK_SIZE).trim();
    if (c.length > 200) chunks.push(c);
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

(async () => {
  const files = scanKB(KB_ROOT);
  for (const f of files) {
    const text = await extractText(f);
    for (const chunk of chunkText(text)) {
      const e = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: chunk
      });
      kbChunks.push({
        text: chunk,
        embedding: e.data[0].embedding
      });
    }
  }
  console.log("KB embeddings loaded:", kbChunks.length);
})();

/* ===============================
   KB RETRIEVAL
   =============================== */

async function retrieveKB(question) {
  const qEmb = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: question
  });
  const qVec = qEmb.data[0].embedding;

  return kbChunks
    .map(c => ({
      text: c.text,
      score: c.embedding.reduce((s, v, i) => s + v * qVec[i], 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}

/* ===============================
   DETECTION HELPERS
   =============================== */

function extractYear(q) {
  const m = q.match(/\b20(2[3-9]|3[0-5])\b/);
  return m ? m[0] : null;
}

function isFactualCurrentPMC(q) {
  const t = q.toLowerCase();
  const triggers = [
    "recent", "latest", "announce", "announced", "launch",
    "introduced", "press release", "news", "update"
  ];
  if (extractYear(q)) return true;
  return triggers.some(w => t.includes(w));
}

function isCurrentGeneral(q) {
  const t = q.toLowerCase();
  return (
    t.includes("today") ||
    t.includes("current") ||
    t.includes("latest") ||
    t.includes("now")
  );
}

/* ===============================
   SYSTEM INSTRUCTIONS
   =============================== */

const PMC_SYSTEM_INSTRUCTION = `
You are PMC CENTRE AI. Answer professionally and practically for paper machine clothing experts.
Rules:
- Give a complete answer within the allowed length.
- Keep answers factual and verifiable.
- Use plain text only.
`;

const GENERAL_SYSTEM_INSTRUCTION = `
Answer clearly and factually.
Use plain paragraphs only.
Do not use bullets, numbering, markdown, or special formatting.
If verification is not possible, say so clearly.
`;

const LIVE_SYSTEM_INSTRUCTION = `
You are a LIVE WEB INFORMATION assistant.

Rules:
- Use ONLY live web search results
- Do NOT use PMC knowledge base
- Do NOT provide PMC technical advice
- If information is uncertain, say so clearly
- Be neutral and factual
- Begin every answer with:
  "Based on live web information as of today:"
`;

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", async (req, res) => {
  try {
    const { question, mode } = req.body;
    let answer = "";

    /* ---------- PMC MODE (UNCHANGED) ---------- */
    if (mode === "PMC") {
      let pmcFactual = isFactualCurrentPMC(question);
      let usedKB = false;
      let context = "";

      if (pmcFactual) {
        answer =
          "This question relates to recent or time-bound factual information. " +
          "PMC Expert Mode does not provide live announcements.";
      } else {
        const kb = await retrieveKB(question);
        if (kb.length > 0) {
          usedKB = true;
          context = kb.map(k => k.text).join("\n\n");
        }

        if (context.length < 400) {
          answer =
            "This question requires case-specific technical review. " +
            "Please contact support@pmccentre.com for expert assistance.";
        } else {
          const r = await openai.responses.create({
            model: "gpt-5.2",
            input: [
              { role: "system", content: PMC_SYSTEM_INSTRUCTION },
              { role: "user", content: "Context:\n" + context + "\n\nQuestion:\n" + question }
            ],
            max_output_tokens: 600
          });
          answer = r.output_text || "";
        }
      }

      console.log("[PMC MODE] KB used:", usedKB);
    }

   
    /* ---------- LIVE MODE (SAFE FALLBACK) ---------- */
else if (mode === "LIVE") {
  console.log("[LIVE MODE] Web search enabled");

  try {
    const r = await openai.responses.create({
      model: "gpt-5.2",
      tools: [{ type: "web_search" }],
      input: [
        { role: "system", content: LIVE_SYSTEM_INSTRUCTION },
        { role: "user", content: question }
      ],
      max_output_tokens: 450
    });

    answer = r.output_text || "";

    if (!answer || answer.trim().length < 40) {
      answer =
        "Based on live web information as of today: " +
        "Live sources did not return sufficient verified data for this query. " +
        "Please try again shortly or contact support@pmccentre.com.";
    }

  } catch (liveErr) {
    console.error("[LIVE MODE ERROR]", liveErr);

    answer =
      "Based on live web information as of today: " +
      "Live web sources could not be reliably reached at this moment. " +
      "Please retry after some time or contact support@pmccentre.com.";
  }
}

    /* ---------- GENERAL MODE (UNCHANGED) ---------- */
    else {
      const current = isCurrentGeneral(question);

      const r = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          { role: "system", content: GENERAL_SYSTEM_INSTRUCTION },
          { role: "user", content: question }
        ],
        max_output_tokens: 400
      });

      answer = r.output_text || "";

      if (!answer || answer.trim().length < 30) {
        answer =
          "This question may require clarification or reliable external verification. " +
          "Please rephrase or provide more specific details.";
      }

      console.log("[GENERAL MODE] Current topic:", current);
    }

    res.json({ answer });

  } catch (err) {
    console.error("ASK ERROR:", err);
    res.status(500).json({
      answer: "Backend error occurred. Please try again later."
    });
  }
});

/* ===============================
   START SERVER
   =============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("PMC CENTRE AI backend running on port", PORT);
});
