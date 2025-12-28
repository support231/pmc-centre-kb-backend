import fs from "fs";
import path from "path";
import express from "express";

const app = express();
app.use(express.json());

/* ===============================
   KB LOADER CONFIG
   =============================== */

const KB_ROOT = path.join(process.cwd(), "KB");
const ADANUR_PREFIX = "PaperMachineClothingAdanur_";

/* ===============================
   KB SCAN LOGIC
   =============================== */

function scanKB(dirPath, collected = []) {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dirPath, item.name);

    if (item.isDirectory()) {
      scanKB(fullPath, collected);
    } else {
      collected.push(fullPath);
    }
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

  if (filePath.includes(`${path.sep}Forming${path.sep}`)) {
    section = "forming";
  } else if (filePath.includes(`${path.sep}Felt${path.sep}`)) {
    section = "felt";
  } else if (filePath.includes(`${path.sep}Dryer${path.sep}`)) {
    section = "dryer";
  }

  return {
    filename,
    kb_type,
    section,
    path: filePath,
  };
}

/* ===============================
   LOAD KB ON STARTUP
   =============================== */

console.log("🔹 KB LOADER START");

let kbFiles = [];

try {
  const allFiles = scanKB(KB_ROOT);
  kbFiles = allFiles.map(classifyFile);

  const practicalCount = kbFiles.filter(
    f => f.kb_type === "practical_kb"
  ).length;

  const referenceCount = kbFiles.filter(
    f => f.kb_type === "reference_book"
  ).length;

  console.log("✅ KB ROOT:", KB_ROOT);
  console.log("📚 TOTAL FILES:", kbFiles.length);
  console.log("📄 PRACTICAL KB FILES:", practicalCount);
  console.log("📘 REFERENCE BOOK FILES:", referenceCount);

  console.log("🔍 KB INVENTORY:");
  kbFiles.forEach(f => {
    console.log(
      ` - ${f.filename} | type=${f.kb_type} | section=${f.section}`
    );
  });

} catch (err) {
  console.error("❌ KB LOADER ERROR:", err);
}

/* ===============================
   ASK ENDPOINT (SAFE STUB)
   =============================== */

app.post("/ask", (req, res) => {
  res.json({
    status: "KB loaded successfully",
    kb_files_loaded: kbFiles.length
  });
});

/* ===============================
   HEALTH CHECK
   =============================== */

app.get("/", (_, res) => {
  res.send("PMC CENTRE AI backend running (KB Loader v1)");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("🚀 Server running on port", PORT);
});
