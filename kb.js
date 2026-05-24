import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, "KB");

/* ===============================
   LOAD ALL KB TEXTS AT STARTUP
   =============================== */

// We cache all extracted KB text in memory at server start
// so we don't re-read files on every request
const kbCache = {}; // { "filename": "full extracted text" }

async function loadKBFile(filePath, filename) {
  try {
    const buffer = fs.readFileSync(filePath);
    let text = "";

    if (filename.endsWith(".pdf")) {
      const result = await pdfParse(buffer);
      text = result.text || "";
    } else if (filename.endsWith(".docx")) {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    } else if (filename.endsWith(".txt")) {
      text = buffer.toString("utf8");
    }

    // Store trimmed text (limit each file to 50k chars to be safe)
    kbCache[filename] = text.trim().slice(0, 50000);
    console.log(`[KB] Loaded: ${filename} (${kbCache[filename].length} chars)`);
  } catch (err) {
    console.error(`[KB] Failed to load ${filename}:`, err.message);
  }
}

export async function initKB() {
  console.log("[KB] Loading knowledge base files...");
  const subfolders = ["Forming", "Felt", "Dryer", "Reference_Books"];

  for (const folder of subfolders) {
    const folderPath = path.join(KB_DIR, folder);
    if (!fs.existsSync(folderPath)) continue;

    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      const filePath = path.join(folderPath, file);
      await loadKBFile(filePath, `${folder}/${file}`);
    }
  }

  const totalFiles = Object.keys(kbCache).length;
  const totalChars = Object.values(kbCache).reduce((sum, t) => sum + t.length, 0);
  console.log(`[KB] Ready: ${totalFiles} files, ~${Math.round(totalChars / 1000)}k chars total`);
}

/* ===============================
   SEARCH KB FOR RELEVANT CONTEXT
   =============================== */

export function searchKB(question) {
  if (Object.keys(kbCache).length === 0) {
    console.warn("[KB] Cache is empty — KB not loaded yet");
    return "";
  }

  // Extract meaningful keywords from the question
  const stopWords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "to", "of", "in", "on", "at", "by", "for", "with", "about", "against",
    "between", "into", "through", "during", "before", "after", "above",
    "below", "from", "up", "down", "out", "off", "over", "under",
    "again", "further", "then", "once", "how", "what", "why", "when",
    "where", "who", "which", "that", "this", "these", "those", "i",
    "me", "my", "we", "our", "you", "your", "it", "its", "and", "or",
    "but", "if", "so", "yet", "both", "not", "no", "nor",
  ]);

  const keywords = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));

  console.log(`[KB] Searching for keywords: ${keywords.join(", ")}`);

  if (keywords.length === 0) return "";

  const SNIPPET_SIZE = 400;     // chars around a keyword match (was 600)
  const MAX_SNIPPETS = 4;       // max snippets total (was 6)
  const MAX_CONTEXT_CHARS = 2000; // total context injected into prompt (was 3000)

  const snippets = [];

  for (const [filename, text] of Object.entries(kbCache)) {
    const lowerText = text.toLowerCase();

    for (const kw of keywords) {
      let pos = lowerText.indexOf(kw);
      while (pos !== -1 && snippets.length < MAX_SNIPPETS) {
        const start = Math.max(0, pos - 200);
        const end = Math.min(text.length, pos + SNIPPET_SIZE);
        const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();

        if (snippet.length > 80) {
          snippets.push({ filename, snippet, keyword: kw });
          console.log(`[KB] Match: "${kw}" in ${filename} at pos ${pos}`);
        }

        // Find next occurrence (skip ahead to avoid duplicate snippets)
        pos = lowerText.indexOf(kw, pos + SNIPPET_SIZE);
      }

      if (snippets.length >= MAX_SNIPPETS) break;
    }

    if (snippets.length >= MAX_SNIPPETS) break;
  }

  if (snippets.length === 0) {
    console.log("[KB] No relevant matches found in knowledge base");
    return "";
  }

  // Build the context block
  const contextParts = snippets.map(
    (s) => `[Source: ${s.path || s.filename}]\n${s.snippet}`
  );

  let context = contextParts.join("\n\n---\n\n");

  // Trim to max chars
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS) + "...";
  }

  console.log(
    `[KB] Injecting ${snippets.length} snippet(s), ${context.length} chars into prompt`
  );

  return context;
}
