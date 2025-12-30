import fs from "fs";
import path from "path";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { upload, extractUploadedText } from "./upload.js";

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

async function extractKBText(file) {
  if (file.endsWith(".docx")) {
    const r = await import("mammoth").then(m =>
      m.extractRawText({ path: file })
    );
    return r.value || "";
  }
  if (file.endsWith(".pdf")) {
    const pdfParse = (await import("pdf-parse")).default;
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
    const text = await extractKBText(f);
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
   DETECTION HELPERS
   =============================== */

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
- Keep answers factual and verifiable.
- Use plain text only.
`;

const GENERAL_SYSTEM_INSTRUCTION = `
Answer clearly and factually.
Use plain paragraphs only.
If verification is not possible, say so clearly.
`;

const LIVE_SYSTEM_INSTRUCTION = `
You are a LIVE WEB INFORMATION assistant.
Rules:
- Use only live web information.
- Do not provide PMC technical advice.
- Be transparent and factual.
- Start answers with: "Based on live web information as of today:"
`;

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", upload.single("file"), async (req, res) => {
  try {
    const { question, mode } = req.body;
    let answer = "";

    /* ---------- FILE CONTEXT ---------- */
    let uploadedText = "";
    if (req.file) {
      uploadedText = await extractUploadedText(req.file);
      if (uploadedText.length > 6000) {
        uploadedText = uploadedText.slice(0, 6000);
      }
      console.log("[UPLOAD]", req.file.originalname, req.file.size);
    }

    /* ---------- LIVE MODE ---------- */
    if (mode === "LIVE") {
      if (req.file) {
        return res.json({
          answer:
            "Live Web Search does not support document or image analysis. " +
            "Please remove the file or switch to PMC or General mode."
        });
      }

      try {
        const r = await openai.responses.create({
          model: "gpt-5.2",
          tools: [{ type: "web_search" }],
          input: [
            { role: "system", content: LIVE_SYSTEM_INSTRUCTION },
            { role: "user", content: question }
          ],
          max_output_tokens: 450
        });

        answer = r.output_text || "";
      } catch {
        answer =
          "Based on live web information as of today: " +
          "Live sources could not be reached reliably. Please retry later or contact support@pmccentre.com.";
      }
    }

    /* ---------- PMC MODE ---------- */
    else if (mode === "PMC") {
      const r = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          { role: "system", content: PMC_SYSTEM_INSTRUCTION },
          {
            role: "user",
            content:
              uploadedText
                ? "Uploaded material:\n" +
                  uploadedText +
                  "\n\nQuestion:\n" +
                  question
                : question
          }
        ],
        max_output_tokens: 600
      });

      answer = r.output_text || "";
    }

    /* ---------- GENERAL MODE ---------- */
    else {
      const r = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          { role: "system", content: GENERAL_SYSTEM_INSTRUCTION },
          {
            role: "user",
            content:
              uploadedText
                ? "Document:\n" +
                  uploadedText +
                  "\n\nQuestion:\n" +
                  question
                : question
          }
        ],
        max_output_tokens: 400
      });

      answer = r.output_text || "";

      if (!answer || answer.trim().length < 30) {
        answer =
          "This question may require clarification or reliable external verification.";
      }
    }

    res.json({ answer });

  } catch (err) {
    console.error("ASK ERROR:", err);
    res.status(500).json({
      answer:
        "Backend error occurred while processing your request. Please try again later."
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
