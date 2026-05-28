import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "KB_CACHE");

/* ===============================
   CONFIGURATION
   =============================== */

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_BATCH_SIZE = 50;
const SIMILARITY_THRESHOLD = 0.72;
const MAX_RESULTS = 4;
const MAX_CONTEXT_CHARS = 2500;

/* ===============================
   LIGHTWEIGHT OPENAI EMBEDDINGS (no SDK needed)
   =============================== */

async function callEmbeddingsAPI(input) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Embeddings API error ${res.status}: ${err}`);
  }

  return await res.json();
}

/* ===============================
   IN-MEMORY VECTOR STORE
   =============================== */

const vectorStore = [];

/* ===============================
   TEXT CHUNKING
   =============================== */

function chunkText(text, source) {
  const chunks = [];

  if (text.length <= CHUNK_SIZE) {
    chunks.push({ text, source, chunkIndex: 0 });
    return chunks;
  }

  let pos = 0;
  let chunkIndex = 0;

  while (pos < text.length) {
    let end = Math.min(pos + CHUNK_SIZE, text.length);

    if (end < text.length) {
      const searchStart = pos + Math.floor(CHUNK_SIZE * 0.6);
      if (searchStart < end) {
        const window = text.slice(searchStart, end);
        const sentEnd = Math.max(
          window.lastIndexOf(". "),
          window.lastIndexOf("? "),
          window.lastIndexOf("! "),
        );
        if (sentEnd > 0) end = searchStart + sentEnd + 1;
      }
    }

    const chunk = text.slice(pos, end).trim();
    if (chunk.length > 40) {
      chunks.push({ text: chunk, source, chunkIndex });
      chunkIndex++;
    }

    pos = end - CHUNK_OVERLAP;
    if (pos >= text.length) break;
  }

  return chunks;
}

/* ===============================
   EMBEDDING GENERATION
   =============================== */

async function embedChunks(chunks) {
  const results = [];

  for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
    const texts = batch.map((c) => c.text);

    try {
      const response = await callEmbeddingsAPI(texts);

      for (let j = 0; j < response.data.length; j++) {
        results.push({
          ...batch[j],
          embedding: new Float32Array(response.data[j].embedding),
        });
      }

      console.log(`[KB-RAG] Embedded batch ${Math.floor(i / EMBEDDING_BATCH_SIZE) + 1}: ${batch.length} chunks`);
    } catch (err) {
      console.error(`[KB-RAG] Embedding batch failed:`, err.message);
    }
  }

  return results;
}

async function embedQuery(text) {
  const response = await callEmbeddingsAPI(text);
  return new Float32Array(response.data[0].embedding);
}

/* ===============================
   COSINE SIMILARITY
   =============================== */

function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

/* ===============================
   INIT: READ CACHED TEXT → CHUNK → EMBED
   =============================== */

export async function initKB() {
  console.log("[KB-RAG] Initializing knowledge base with vector embeddings...");

  if (!fs.existsSync(CACHE_DIR)) {
    console.error("[KB-RAG] KB_CACHE/ not found! Run: node --max-old-space-size=4096 extract-kb.js");
    return;
  }

  const subfolders = ["Forming", "Felt", "Dryer", "Reference_Books"];
  const allChunks = [];

  for (const folder of subfolders) {
    const cacheFolderPath = path.join(CACHE_DIR, folder);
    if (!fs.existsSync(cacheFolderPath)) continue;

    const files = fs.readdirSync(cacheFolderPath).filter((f) => f.endsWith(".txt"));
    for (const file of files) {
      try {
        const filePath = path.join(cacheFolderPath, file);
        const source = `${folder}/${file}`;
        const text = fs.readFileSync(filePath, "utf8").trim();

        if (text.length < 50) continue;

        const chunks = chunkText(text, source);
        allChunks.push(...chunks);
        console.log(`[KB-RAG] ✓ ${source}: ${text.length} chars → ${chunks.length} chunks`);
      } catch (err) {
        console.error(`[KB-RAG] Failed: ${folder}/${file}:`, err.message);
      }
    }
  }

  if (allChunks.length === 0) {
    console.warn("[KB-RAG] No chunks found in KB_CACHE/.");
    return;
  }

  console.log(`[KB-RAG] Total chunks to embed: ${allChunks.length}`);
  const embeddedChunks = await embedChunks(allChunks);

  vectorStore.length = 0;
  vectorStore.push(...embeddedChunks);

  console.log(`[KB-RAG] ✅ Vector store ready: ${vectorStore.length} chunks indexed`);
}

/* ===============================
   SEARCH: SEMANTIC VECTOR SEARCH
   =============================== */

export async function searchKB(question) {
  if (vectorStore.length === 0) {
    console.warn("[KB-RAG] Vector store empty — KB not initialized");
    return "";
  }

  try {
    const queryVector = await embedQuery(question);

    const scored = vectorStore.map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(queryVector, chunk.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);

    const relevant = scored
      .filter((c) => c.score >= SIMILARITY_THRESHOLD)
      .slice(0, MAX_RESULTS);

    if (relevant.length === 0) {
      console.log(`[KB-RAG] No relevant context (best: ${scored[0]?.score.toFixed(3) || "N/A"})`);
      return "";
    }

    console.log(`[KB-RAG] Found ${relevant.length} relevant chunk(s):`);
    relevant.forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.score.toFixed(3)}] ${c.source} (chunk #${c.chunkIndex})`);
    });

    const contextParts = relevant.map(
      (c) => `[Source: ${c.source} | Relevance: ${(c.score * 100).toFixed(0)}%]\n${c.text}`
    );

    let context = contextParts.join("\n\n---\n\n");
    if (context.length > MAX_CONTEXT_CHARS) {
      context = context.slice(0, MAX_CONTEXT_CHARS) + "...";
    }

    console.log(`[KB-RAG] Injecting ${relevant.length} chunk(s), ${context.length} chars`);
    return context;

  } catch (err) {
    console.error("[KB-RAG] Search error:", err.message);
    return "";
  }
}
