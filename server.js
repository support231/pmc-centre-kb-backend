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
const ADANUR_PREFIX = "PaperMachineClothingAdanur_";

const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 200;
const TOP_K = 5;

/* ===============================
   FILE SCAN & CLASSIFICATION
   =============================== */

function scanKB(dirPath, collected = []) {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);
    if (item.isDirectory()) scanKB(fullPath, collected);
    else collected.push(fullPath);
  }
  return collected;
}

function classifyFile(filePath) {
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();

  let kb_type = "practical_kb";
  if (ext === ".pdf" && filename.startsWith(ADANUR_PREFIX)) {
    kb_type = "reference_book";
  }

  let section = "general";
  if (filePath.includes(`${path.sep}Forming${path.sep}`)) section = "forming";
  else if (filePath.includes(`${path.sep}Felt${path.sep}`)) section = "felt";
  else if (filePath.includes(`${path.sep}Dryer${path.sep}`)) section = "dryer";

  return { filename, ext, kb_type, section, path: filePath };
}

/* ===============================
   TEXT EXTRACTION
   =============================== */

async function extractText(file) {
  if (file.ext === ".docx") {
    const result = await mammoth.extractRawText({ path: file.path });
    return result.value || "";
  }

  if (file.ext === ".pdf") {
    const buffer = fs.readFileSync(file.path);
    const data = await pdfParse(buffer);
    return data.text || "";
  }

  return "";
}

/* ===============================
   CHUNKING
   =============================== */

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

/* ===============================
   VECTOR STORE
   =============================== */

let kbChunks = [];

/* ===============================
   LOAD → EMBED
   =============================== */

(async () => {
  const files = scanKB(KB_ROOT).map(classifyFile);

  for (const file of files) {
    const text = await extractText(file);
    const chunks = chunkText(text);

    for (const chunk of chunks) {
      const emb = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: chunk
      });

      kbChunks.push({
        embedding: emb.data[0].embedding,
        text: chunk
      });
    }
  }
})();

/* ===============================
   INTENT DETECTION (UNCHANGED)
   =============================== */

async function detectIntent(question) {
  const r = await openai.responses.create({
    model: "gpt-5.2",
    input: [
      { role: "system", content: "Classify the user question. Reply with ONE WORD only: PMC or GENERAL." },
      { role: "user", content: question }
    ],
    max_output_tokens: 16
  });

  const text = r.output_text || r.output?.[0]?.content?.[0]?.text || "";
  return text.toUpperCase().includes("PMC") ? "PMC" : "GENERAL";
}

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
   STEP 2.2 – PMC CENTRE SITE FETCH
   =============================== */

async function fetchPmcCentreContent() {
  const urls = [
    "https://www.pmccentre.com",
    "https://www.pmccentre.com/blog"
  ];

  let combinedText = "";

  for (const url of urls) {
    try {
      const res = await fetch(url);
      const html = await res.text();

      const textOnly = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");

      combinedText += "\n" + textOnly;
    } catch (e) {
      console.error("PMC site fetch failed:", url);
    }
  }

  return combinedText.slice(0, 6000);
}

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", async (req, res) => {
  try {
    const question = req.body.question || "";
    const intent = await detectIntent(question);

    let answer = "";

    if (intent === "PMC") {
      const kbMatches = await retrieveKB(question);
      let context = kbMatches.map(m => m.text).join("\n\n");

      if (context.length < 800) {
        const siteText = await fetchPmcCentreContent();
        context += "\n\n" + siteText;
      }

      const r = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          {
            role: "system",
            content:
              "You are PMC CENTRE AI. Answer professionally and practically. Use plain text only. Do not use markdown, bullets, or asterisks."
          },
          {
            role: "user",
            content: "Context:\n" + context + "\n\nQuestion:\n" + question
          }
        ],
        max_output_tokens: 600
      });

      answer = r.output_text || "";

    } else {
      const r = await openai.responses.create({
        model: "gpt-5.2",
        input: question,
        max_output_tokens: 400
      });
      answer = r.output_text || "";
    }

    res.json({ intent, answer });

  } catch (err) {
    console.error(err);
    res.status(500).json({ intent: "ERROR", answer: "Backend error." });
  }
});

/* ===============================
   START SERVER
   =============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
