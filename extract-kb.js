/**
 * PRE-EXTRACTION SCRIPT
 * 
 * Run this ONCE (or whenever KB files change) to extract text from PDFs/DOCX
 * into lightweight .txt cache files. The main kb.js reads from these caches
 * at startup instead of parsing heavy PDFs every time.
 * 
 * Usage: node --max-old-space-size=4096 extract-kb.js
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_DIR = path.join(__dirname, "KB");
const CACHE_DIR = path.join(__dirname, "KB_CACHE");
const MAX_FILE_CHARS = 15000;

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

async function extractFile(filePath, filename) {
  let text = "";

  if (filename.endsWith(".pdf")) {
    const buffer = fs.readFileSync(filePath);
    const result = await pdfParse(buffer, { max: 30 });
    text = (result.text || "").slice(0, MAX_FILE_CHARS);
  } else if (filename.endsWith(".docx")) {
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    text = (result.value || "").slice(0, MAX_FILE_CHARS);
  } else if (filename.endsWith(".txt")) {
    text = fs.readFileSync(filePath, "utf8").slice(0, MAX_FILE_CHARS);
  }

  return text.replace(/\s+/g, " ").trim();
}

async function main() {
  console.log("[EXTRACT] Starting KB text extraction...");
  const subfolders = ["Forming", "Felt", "Dryer", "Reference_Books"];

  for (const folder of subfolders) {
    const folderPath = path.join(KB_DIR, folder);
    if (!fs.existsSync(folderPath)) continue;

    // Create subfolder in cache
    const cacheFolderPath = path.join(CACHE_DIR, folder);
    if (!fs.existsSync(cacheFolderPath)) {
      fs.mkdirSync(cacheFolderPath, { recursive: true });
    }

    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      try {
        const filePath = path.join(folderPath, file);
        const cacheFile = path.join(cacheFolderPath, file.replace(/\.(pdf|docx)$/i, ".txt"));

        console.log(`[EXTRACT] Processing: ${folder}/${file}...`);
        const text = await extractFile(filePath, file);

        if (text.length < 50) {
          console.warn(`[EXTRACT] Skipping ${folder}/${file} — too little text`);
          continue;
        }

        fs.writeFileSync(cacheFile, text, "utf8");
        console.log(`[EXTRACT] ✓ ${folder}/${file} → ${text.length} chars → ${path.basename(cacheFile)}`);
      } catch (err) {
        console.error(`[EXTRACT] ✗ Failed: ${folder}/${file}: ${err.message}`);
      }
    }
  }

  console.log("[EXTRACT] Done! Cached text files written to KB_CACHE/");
}

main().catch(console.error);
