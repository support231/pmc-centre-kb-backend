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
- If the question is vague, incomplete, or ambiguous, ASK A CLARIFYING QUESTION.
- Never respond with generic system errors to the user.
- Never say "try again" unless there is a confirmed infrastructure failure.
- Do NOT use Markdown symbols (*, **, -, #).
- Use plain text only.
- For emphasis, use CAPITAL LETTER headings, not symbols.
- Do NOT mention files unless a file is actually provided.
- Never fabricate processing or system failures.
- If information is insufficient, pause and ask for missing details.
`;

const PMC_SYSTEM_INSTRUCTION = `
You are PMC CENTRE AI, a senior technical consultant for paper machine clothing professionals.

${COMMON_RULES}

Additional PMC rules:
- Assume the user expects an expert-level technical response.
- If machine type, paper grade, position (forming/press/dryer), or operating conditions are missing, ask targeted clarification questions BEFORE answering.
- Be practical, experience-based, and concise.
- Structure answers with short paragraphs and CAPITAL LETTER section headings.
- Do not use bullet symbols or stars.
`;

const GENERAL_SYSTEM_INSTRUCTION = `
You are a General AI Assistant.

${COMMON_RULES}

- Be clear, neutral, and helpful.
- Ask clarifying questions if the intent is not fully clear.
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
    return t + "\n\nIf you want, I can continue with more detail.";
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
        answer:
          "I need a bit more detail to proceed. Could you please clarify your question?"
      });
    }

    let uploadedText = "";
    if (req.file) {
      uploadedText = await extractUploadedText(req.file);
      if (!uploadedText || uploadedText.trim().length < 30) {
        return res.json({
          answer:
            "I received the uploaded file, but I could not extract enough readable information from it. Could you please clarify what you want me to analyze from this file?"
        });
      }
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
            "Current Updates mode does not support document or image analysis. Please switch to PMC Expert Mode or General AI Assistant."
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
      const userContent = uploadedText
        ? `UPLOADED MATERIAL:\n${uploadedText}\n\nTECHNICAL QUESTION:\n${question}`
        : question;

      const r = await openai.responses.create({
        model: "gpt-5.2",
        input: [
          { role: "system", content: PMC_SYSTEM_INSTRUCTION },
          { role: "user", content: userContent }
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
                ? `DOCUMENT CONTENT:\n${uploadedText}\n\nQUESTION:\n${question}`
                : question
          }
        ],
        max_output_tokens: 600
      });

      answer = finalizeAnswer(r.output_text);
    }

    if (!answer || answer.length < 15) {
      answer =
        "I need a bit more information to give you a precise answer. Could you please clarify your requirement?";
    }

    res.json({ answer });

  } catch (err) {
    console.error("ASK ERROR:", err);

    // IMPORTANT: no vague errors for users
    res.json({
      answer:
        "I’m unable to confidently interpret the request with the information available. Could you please clarify what you want me to focus on?"
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
