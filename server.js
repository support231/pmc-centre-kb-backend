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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ===============================
   KB SETUP
   =============================== */

const KB_ROOT = path.join(process.cwd(), "KB");
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const TOP_K = 5;
let kbChunks = [];

function scanKB(dirPath, collected = []) {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) scanKB(fullPath, collected);
    else collected.push(fullPath);
  }
  return collected;
}

async function extractText(filePath) {
  if (filePath.endsWith(".docx")) {
    const r = await mammoth.extractRawText({ path: filePath });
    return r.value || "";
  }
  if (filePath.endsWith(".pdf")) {
    const buffer = fs.readFileSync(filePath);
    const r = await pdfParse(buffer);
    return r.text || "";
  }
  return "";
}

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = start + CHUNK_SIZE;
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 200) chunks.push(chunk);
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
  }
  return chunks;
}

function cosineSimilarity(a, b) {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

(async () => {
  const files = scanKB(KB_ROOT);
  for (const file of files) {
    const text = await extractText(file);
    const chunks = chunkText(text);
    for (const c of chunks) {
      const emb = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: c
      });
      kbChunks.push({
        text: c,
        embedding: emb.data[0].embedding
      });
    }
  }
})();

/* ===============================
   HELPERS
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
      score: cosineSimilarity(qVec, c.embedding)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}

async function fetchTextFromUrl(url) {
  try {
    const r = await fetch(url);
    const html = await r.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 5000);
  } catch {
    return "";
  }
}

function needsCurrentInfo(q) {
  const t = q.toLowerCase();
  return (
    t.includes("today") ||
    t.includes("latest") ||
    t.includes("current") ||
    t.includes("now")
  );
}

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", async (req, res) => {
  try {
    const { question, mode } = req.body;
    let answer = "";

    if (mode === "PMC") {
      // 2.1 KB
      const kb = await retrieveKB(question);
      let context = kb.map(k => k.text).join("\n\n");

      // 2.2 PMC site + blog
      if (context.length < 800) {
        context += "\n" + await fetchTextFromUrl("https://www.pmccentre.com");
        context += "\n" + await fetchTextFromUrl("https://www.pmccentre.com/blog");
      }

      // 2.3 External reputed sites (basic)
      if (context.length < 1200) {
        context += "\n" + await fetchTextFromUrl("https://www.valmet.com");
        context += "\n" + await fetchTextFromUrl("https://www.andritz.com");
      }

      // 2.4 Fallback
      if (context.trim().length < 500) {
        answer =
          "This question requires case-specific technical review.\n" +
          "Please contact support@pmccentre.com for expert assistance.";
      } else {
        const r = await openai.responses.create({
          model: "gpt-5.2",
          input: [
            {
              role: "system",
              content:
                "You are PMC CENTRE AI. Answer professionally and practically. " +
                "Use plain text only. Do not use markdown, bullets, or asterisks."
            },
            {
              role: "user",
              content: "Context:\n" + context + "\n\nQuestion:\n" + question
            }
          ],
          max_output_tokens: 600
        });
        answer = r.output_text || "";
      }

    } else {
      // GENERAL
      let prompt = question;

      if (needsCurrentInfo(question)) {
        prompt =
          question +
          "\n\nIf live data is required and unavailable, say so clearly.";
      }

      const r = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          {
            role: "system",
            content:
              "Answer clearly in plain text only. Do not use markdown, bullets, or asterisks."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_output_tokens: 400
      });

      answer = r.output_text || "";
    }

    res.json({ answer });

  } catch (err) {
    res.status(500).json({
      answer: "Backend error occurred. Please try again later."
    });
  }
});

/* ===============================
   START
   =============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("PMC CENTRE AI backend running on port", PORT);
});
