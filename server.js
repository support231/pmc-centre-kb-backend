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
   SYSTEM INSTRUCTIONS
   =============================== */

const COMMON_RULES = `
Critical rules (must follow strictly):
- If the question is vague, ambiguous, or underspecified, ASK a clarifying question.
- Do NOT say the request failed unless there is a real technical error.
- Do NOT mention files, uploads, or removal unless a file is actually provided.
- Never fabricate system or processing errors.
- If a list is long, do not cut silently. Say if more items remain.
`;

const PMC_SYSTEM_INSTRUCTION = `
You are PMC CENTRE AI for paper machine clothing professionals.

${COMMON_RULES}

PMC-specific rules:
- Prioritize technical correctness and practical clarity.
- If input lacks machine type, section, grade, or operating conditions, ask for them.
- Use clear, professional language.
- Plain text only.
`;

const GENERAL_SYSTEM_INSTRUCTION = `
You are a General AI Assistant.

${COMMON_RULES}

General rules:
- Answer clearly and factually.
- If completeness cannot be guaranteed, say so politely.
- Ask clarifying questions instead of refusing.
- Plain paragraphs only.
`;

const LIVE_SYSTEM_INSTRUCTION = `
You are a LIVE WEB INFORMATION assistant.

Rules:
- Use only live web information.
- Do NOT provide PMC technical advice.
- Start answers with: "Based on live web information as of today:"
- If the query is unclear, ask a clarifying question.
`;

/* ===============================
   HELPER
   =============================== */

function ensureGracefulEnding(text) {
  if (!text) return "";

  const trimmed = text.trim();
  const lastChar = trimmed.slice(-1);

  if (
    trimmed.length > 500 &&
    ![".", "!", "?", ":"].includes(lastChar)
  ) {
    return (
      trimmed +
      "\n\nMore information is available. Ask me to continue if needed."
    );
  }
  return trimmed;
}

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", (req, res) => {
  upload.single("file")(req, res, async (uploadErr) => {

    /* ---------- MULTER ERRORS ---------- */
    if (uploadErr) {
      return res.json({
        answer:
          uploadErr.message === "Unsupported file type"
            ? "This file format is not supported. Please upload PDF, Word, text, or image files."
            : "There was a problem processing the uploaded file. Please try a smaller file."
      });
    }

    try {
      const { question, mode } = req.body;
      let answer = "";

      if (!question || !question.trim()) {
        return res.json({
          answer: "Could you please clarify what you would like to know?"
        });
      }

      /* ---------- FILE CONTEXT ---------- */
      let uploadedText = "";
      if (req.file) {
        uploadedText = await extractUploadedText(req.file);
        if (uploadedText.length > 6000) {
          uploadedText = uploadedText.slice(0, 6000);
        }
      }

      /* ---------- LIVE MODE ---------- */
      if (mode === "LIVE") {
        if (req.file) {
          return res.json({
            answer:
              "Current Updates mode does not support document or image analysis. Please switch to PMC or General mode."
          });
        }

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
                  ? `Uploaded material:\n${uploadedText}\n\nQuestion:\n${question}`
                  : question
            }
          ],
          max_output_tokens: 800
        });

        answer = ensureGracefulEnding(r.output_text || "");
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
                  ? `Document:\n${uploadedText}\n\nQuestion:\n${question}`
                  : question
            }
          ],
          max_output_tokens: 600
        });

        answer = ensureGracefulEnding(r.output_text || "");
      }

      if (!answer || answer.trim().length < 10) {
        answer =
          "Could you please clarify your question so I can answer more precisely?";
      }

      res.json({ answer });

    } catch (err) {
      console.error("ASK ERROR:", err);
      res.status(500).json({
        answer:
          "A temporary system issue occurred. Please try again in a moment."
      });
    }
  });
});

/* ===============================
   START SERVER
   =============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("PMC CENTRE AI backend running on port", PORT);
});
