import fs from "fs";
import path from "path";
import express from "express";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import OpenAI from "openai";

const app = express();
app.use(express.json());

/* ===============================
   OPENAI CLIENT (EMBEDDINGS ONLY)
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
   VECTOR MATH
   =============================== */

function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (magA * magB);
}

/* ===============================
   PIPELINE: LOAD → EMBED → TEST
   =============================== */

console.log("🔹 EMBEDDINGS PIPELINE START");

let kbChunks = [];

(async () => {
  try {
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
          text: chunk,
          filename: file.filename,
          kb_type: file.kb_type,
          section: file.section
        });
      }

      console.log(
        `📄 ${file.filename} → ${chunks.length} chunks embedded`
      );
    }

    console.log("✅ EMBEDDINGS READY");
    console.log("📚 TOTAL CHUNKS:", kbChunks.length);

    /* ===============================
       AUTO RETRIEVAL SELF-TEST
       =============================== */

    const testQuestion = "What is stacking in SSB forming fabric?";

    const testEmbedding = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: testQuestion
    });

    const testVector = testEmbedding.data[0].embedding;

    const scored = kbChunks.map(chunk => ({
      ...chunk,
      score: cosineSimilarity(testVector, chunk.embedding)
    }));

    const top = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP_K);

    console.log("🔍 AUTO RETRIEVAL TEST RESULTS:");
    top.forEach(t => {
      console.log(
        ` - ${t.filename} | section=${t.section} | type=${t.kb_type} | score=${t.score.toFixed(3)}`
      );
    });

  } catch (err) {
    console.error("❌ PIPELINE ERROR:", err);
  }
})();

/* ===============================
   DUMMY ENDPOINT (SAFE)
   =============================== */

app.post("/ask", (_, res) => {
  res.json({ status: "Backend running. Retrieval tested in logs." });
});

/* ===============================
   HEALTH
   =============================== */

app.get("/", (_, res) => {
  res.send("PMC CENTRE AI backend running (Embeddings + Retrieval Self-Test)");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
