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
   SIMPLE SITE FETCH
   =============================== */

async function fetchText(url, limit = 4000) {
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
   HELPERS
   =============================== */

function isCurrentTopic(q) {
  const t = q.toLowerCase();
  return (
    t.includes("today") ||
    t.includes("latest") ||
    t.includes("current") ||
    t.includes("now")
  );
}

const PMC_SYSTEM_INSTRUCTION = `
You are PMC CENTRE AI. Answer professionally and practically for paper machine clothing experts.
Rules:
- Give a complete answer within the allowed length.
- Never start a point that you cannot finish.
- Keep each point concise (2–3 sentences max).
- If the topic is broad, summarize instead of expanding.
- Prioritize finishing the answer over adding more points.
- Use plain text only. Do not use markdown, bullets, or asterisks.
`;

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", async (req, res) => {
  try {
    const { question, mode } = req.body;
    let answer = "";

    /* LOG FLAGS */
    let usedKB = false;
    let usedPMCsite = false;
    let usedPMCblog = false;
    let usedExternal = [];
    let usedFallback = false;
    let detectedCurrent = false;

    /* ---------- PMC MODE ---------- */
    if (mode === "PMC") {
      let context = "";

      // 2.1 KB
      const kb = await retrieveKB(question);
      if (kb.length > 0) {
        usedKB = true;
        context += kb.map(k => k.text).join("\n\n");
      }

      // 2.2 PMC Centre site + blog
      if (context.length < 800) {
        const site = await fetchText("https://www.pmccentre.com");
        if (site) {
          usedPMCsite = true;
          context += "\n" + site;
        }

        const blog = await fetchText("https://www.pmccentre.com/blog");
        if (blog) {
          usedPMCblog = true;
          context += "\n" + blog;
        }
      }

      // 2.3 External reputed sites
      if (context.length < 1200) {
        const valmet = await fetchText("https://www.valmet.com/pulp-paper");
        if (valmet) {
          usedExternal.push("Valmet");
          context += "\n" + valmet;
        }

        const andritz = await fetchText("https://www.andritz.com/pulp-paper");
        if (andritz) {
          usedExternal.push("Andritz");
          context += "\n" + andritz;
        }
      }

      // 2.4 Fallback
      if (context.trim().length < 500) {
        usedFallback = true;
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

      console.log("[PMC PIPELINE]");
      console.log("KB used:", usedKB);
      console.log("PMC site used:", usedPMCsite);
      console.log("PMC blog used:", usedPMCblog);
      console.log("External reputed sites:", usedExternal.join(", ") || "NONE");
      console.log("Fallback used:", usedFallback);
    }

    /* ---------- GENERAL MODE ---------- */
    else {
      detectedCurrent = isCurrentTopic(question);

      const r = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          {
            role: "system",
            content:
              "Answer clearly and concisely. Use plain text only. Do not use markdown, bullets, or asterisks."
          },
          {
            role: "user",
            content:
              detectedCurrent
                ? question +
                  "\n\nIf live or real-time data is required and unavailable, state that clearly and suggest reliable sources."
                : question
          }
        ],
        max_output_tokens: 400
      });

      answer = r.output_text || "";

      console.log("[GENERAL PIPELINE]");
      console.log("Internal knowledge used: YES");
      console.log("Current topic detected:", detectedCurrent);
      console.log("Live data guidance given:", detectedCurrent);
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
