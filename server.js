import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { upload, extractUploadedText } from "./upload.js";

const app = express();
app.use(cors());

/* IMPORTANT: DO NOT use express.json() for multipart routes */
/* Multer must handle the body first */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ===============================
   SYSTEM INSTRUCTIONS
   =============================== */

const COMMON_RULES = `
Critical rules (must follow strictly):
- If the question is vague or ambiguous, ask a clarifying question.
- Do NOT say the request failed unless there is a real technical error.
- Do NOT mention files unless a file is actually provided.
- Never fabricate processing or system errors.
- If a list is long, do not cut silently.
`;

const PMC_SYSTEM_INSTRUCTION = `
You are PMC CENTRE AI for paper machine clothing professionals.
${COMMON_RULES}
- Ask for missing machine / grade / section details if needed.
- Be technically precise and practical.
`;

const GENERAL_SYSTEM_INSTRUCTION = `
You are a General AI Assistant.
${COMMON_RULES}
- Be clear, neutral, and helpful.
`;

const LIVE_SYSTEM_INSTRUCTION = `
You are a LIVE WEB INFORMATION assistant.
- Use only live web information.
- Start answers with: "Based on live web information as of today:"
- Ask clarifying questions if needed.
`;

function finalizeAnswer(text) {
  if (!text) return "";
  const t = text.trim();
  const last = t.slice(-1);
  if (t.length > 500 && ![".", "!", "?", ":"].includes(last)) {
    return t + "\n\nMore information is available. Ask me to continue.";
  }
  return t;
}

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", upload.single("file"), async (req, res) => {
  try {
    const { question, mode } = req.body;

    if (!question || !question.trim()) {
      return res.json({
        answer: "Could you please clarify your question?"
      });
    }

    let uploadedText = "";
    if (req.file) {
      uploadedText = await extractUploadedText(req.file);
      if (uploadedText.length > 6000) {
        uploadedText = uploadedText.slice(0, 6000);
      }
    }

    let answer = "";

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

      answer = finalizeAnswer(r.output_text);
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

      answer = finalizeAnswer(r.output_text);
    }

    if (!answer || answer.length < 10) {
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

/* ===============================
   START SERVER
   =============================== */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("PMC CENTRE AI backend running on port", PORT);
});
