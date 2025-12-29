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
   WEB FETCH
   =============================== */

async function fetchCleanText(url, limit = 2000) {
  try {
    const r = await fetch(url);
    const html = await r.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, limit);
  } catch {
    return "";
  }
}

/* ===============================
   DETECTION
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

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", async (req, res) => {
  try {
    const { question, mode } = req.body;
    let answer = "";

    let pmcFactual = false;
    let kbBlocked = false;
    let usedKB = false;
    let webAttempted = false;

    /* ---------- PMC MODE ---------- */
    if (mode === "PMC") {
      pmcFactual = isFactualCurrentPMC(question);
      const year = extractYear(question);
      let context = "";

      if (pmcFactual) {
        kbBlocked = true;
        webAttempted = true;

        const sources = [
          "https://www.valmet.com/media/news/",
          "https://www.andritz.com/newsroom-en",
          "https://www.voith.com/news",
          "https://www.astenjohnson.com/news",
          "https://www.albanyinternational.com/news",
          "https://www.tappi.org/news"
        ];

        for (const url of sources) {
          const txt = await fetchCleanText(url);
          if (txt && (!year || txt.includes(year))) {
            context += "\n" + txt;
          }
          if (context.length > 3000) break;
        }

        if (context.length < 500) {
          answer =
            "This question relates to recent or time-bound factual information. " +
            "No verified announcement matching the specified timeframe was found from official sources.";
        } else {
          const r = await openai.responses.create({
            model: "gpt-5.2",
            input: [
              { role: "system", content: PMC_SYSTEM_INSTRUCTION },
              {
                role: "user",
                content:
                  "Verified context:\n" + context + "\n\nQuestion:\n" + question
              }
            ],
            max_output_tokens: 450
          });
          answer = r.output_text || "";
        }
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
              {
                role: "user",
                content:
                  "Context:\n" + context + "\n\nQuestion:\n" + question
              }
            ],
            max_output_tokens: 600
          });
          answer = r.output_text || "";
        }
      }

      console.log("[PMC]");
      console.log("Factual-current:", pmcFactual);
      console.log("KB blocked:", kbBlocked);
      console.log("KB used:", usedKB);
      console.log("Web attempted:", webAttempted);
    }

    /* ---------- GENERAL MODE ---------- */
    else {
      const current = isCurrentGeneral(question);
      let context = "";
      let webUsed = false;

      if (current) {
        webUsed = true;
        const sources = [
          "https://www.britannica.com",
          "https://www.reuters.com",
          "https://www.bbc.com/news"
        ];

        for (const url of sources) {
          const txt = await fetchCleanText(url, 1500);
          if (txt) context += "\n" + txt;
          if (context.length > 2500) break;
        }
      }

      const r = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          {
            role: "system",
            content:
              "Answer clearly and factually. If verification is not possible, say so."
          },
          {
            role: "user",
            content:
              context
                ? "Context:\n" + context + "\n\nQuestion:\n" + question
                : question
          }
        ],
        max_output_tokens: 400
      });

      answer = r.output_text || "";

      if (!answer || answer.trim().length < 20) {
        answer =
          "This question may require clarification or reliable external verification. " +
          "Please rephrase or provide more specific details.";
      }

      console.log("[GENERAL]");
      console.log("Current topic:", current);
      console.log("Web used:", webUsed);
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
