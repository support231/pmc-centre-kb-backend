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
   SYSTEM INSTRUCTIONS
   =============================== */

const PMC_SYSTEM_INSTRUCTION = `
You are PMC CENTRE AI.
Answer professionally and practically for paper machine clothing experts.

Rules:
- Prioritize technical correctness and completeness.
- If a list is long, complete logical sections fully.
- If more items remain, clearly say so and offer to continue.
- Use plain text only.
`;

const GENERAL_SYSTEM_INSTRUCTION = `
Answer clearly and factually.

Rules:
- Do not hallucinate completeness.
- If full verification is not possible, state that clearly.
- If an answer is long, do not truncate silently.
- If more content remains, explicitly say "More available on request."
- Use plain paragraphs only.
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
   HELPER
   =============================== */

function appendContinuationNotice(answer) {
  if (!answer) return answer;

  const trimmed = answer.trim();
  const lastChar = trimmed.slice(-1);

  if (
    trimmed.length > 500 &&
    ![".", "!", "?", ":"].includes(lastChar)
  ) {
    return (
      trimmed +
      "\n\nMore items remain. Ask me to continue if you want the full list."
    );
  }
  return trimmed;
}

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
            "Current Updates mode does not support document or image analysis. " +
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
          "Live sources could not be reached reliably. Please try again later.";
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
        max_output_tokens: 800
      });

      answer = appendContinuationNotice(r.output_text || "");
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
        max_output_tokens: 600
      });

      answer = appendContinuationNotice(r.output_text || "");

      if (!answer || answer.trim().length < 20) {
        answer =
          "I may need clarification or authoritative verification to answer this reliably. " +
          "Please refine the question or ask for a standard accepted list.";
      }
    }

    res.json({ answer });

  } catch (err) {
    console.error("ASK ERROR:", err);
    res.status(500).json({
      answer:
        "A temporary backend error occurred while processing your request. " +
        "Please retry in a moment."
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
