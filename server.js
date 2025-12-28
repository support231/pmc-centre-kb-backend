import fs from "fs";
import path from "path";
import express from "express";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

const app = express();
app.use(express.json());

/* ===============================
   KB CONFIG
   =============================== */

const KB_ROOT = path.join(process.cwd(), "KB");
const ADANUR_PREFIX = "PaperMachineClothingAdanur_";

/* ===============================
   KB SCAN
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
   LOAD + EXTRACT KB
   =============================== */

console.log("🔹 KB TEXT EXTRACTION START");

let kbDocuments = [];

(async () => {
  try {
    const files = scanKB(KB_ROOT).map(classifyFile);

    for (const file of files) {
      const text = await extractText(file);

      kbDocuments.push({
        filename: file.filename,
        kb_type: file.kb_type,
        section: file.section,
        text,
        text_length: text.length
      });

      console.log(
        `📄 ${file.filename} | type=${file.kb_type} | section=${file.section} | chars=${text.length}`
      );
    }

    console.log("✅ KB TEXT EXTRACTION COMPLETE");
    console.log("📚 DOCUMENTS READY:", kbDocuments.length);

  } catch (err) {
    console.error("❌ TEXT EXTRACTION ERROR:", err);
  }
})();

/* ===============================
   ASK ENDPOINT (SAFE STUB)
   =============================== */

app.post("/ask", (_, res) => {
  res.json({
    status: "KB text loaded",
    documents: kbDocuments.length
  });
});

/* ===============================
   HEALTH
   =============================== */

app.get("/", (_, res) => {
  res.send("PMC CENTRE AI backend running (Text Extraction v1)");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
