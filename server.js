import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { upload, extractUploadedText } from "./upload.js";
import { initKB, searchKB } from "./kb.js";

const app = express();
app.use(cors());

// Load KB files into memory at startup
initKB();

/* IMPORTANT: DO NOT use express.json() for multipart routes */
/* Multer must handle the body first */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ===============================
   SYSTEM INSTRUCTIONS
   =============================== */

const COMMON_RULES = `Rules: No Markdown symbols. Use plain text with CAPITAL LETTER headings for emphasis. Never fabricate errors. Always finish your response completely — do not stop mid-sentence or mid-section. If you are running low on space, wrap up with a concise summary.

IMPORTANT: At the very end of every response, you MUST include exactly 3 follow-up questions that help the user dive deeper into the topic. Format them exactly like this on separate lines at the end of your response:
[FOLLOW_UP: Your first follow-up question here?]
[FOLLOW_UP: Your second follow-up question here?]
[FOLLOW_UP: Your third follow-up question here?]
Make these questions specific, practical, and directly related to the topics covered in your answer. They should encourage deeper technical exploration.`;

const PMC_SYSTEM_INSTRUCTION = `You are PMC CENTRE AI, a senior technical consultant for paper machine clothing (forming fabrics, press felts, dryer fabrics).
${COMMON_RULES}
Assume expert-level audience. Provide comprehensive, practical answers. Cover common scenarios when specifics are missing. Structure with short paragraphs and CAPITAL LETTER headings.`;

const GENERAL_SYSTEM_INSTRUCTION = `You are a General AI Assistant. ${COMMON_RULES} Be clear, neutral, and helpful.`;

const LIVE_SYSTEM_INSTRUCTION = `You are a LIVE WEB INFORMATION assistant. Use only live web information. Start answers with: "Based on live web information as of today:" ${COMMON_RULES}`;

function finalizeAnswer(text) {
  if (!text) return "";
  let t = text.trim();
  const last = t.slice(-1);
  // If the text ends abruptly without terminal punctuation, it likely hit the token limit
  const endsCleanly = [".", "!", "?", ":", '"', "'", ")", "]"].includes(last);
  if (t.length > 200 && !endsCleanly) {
    // Find the last complete sentence
    const lastSentenceEnd = Math.max(
      t.lastIndexOf(". "),
      t.lastIndexOf("? "),
      t.lastIndexOf("! "),
      t.lastIndexOf(".\n"),
      t.lastIndexOf("?\n"),
      t.lastIndexOf("!\n")
    );
    if (lastSentenceEnd > t.length * 0.5) {
      // Trim to last complete sentence
      t = t.slice(0, lastSentenceEnd + 1);
    }
    t += "\n\n[Message truncated due to length limit. Would you like me to continue?]";
  }
  return t;
}

// Extract [FOLLOW_UP: ...] tags from the answer and return clean answer + follow-ups
function extractFollowUps(text) {
  const followUps = [];
  const regex = /\[FOLLOW_UP:\s*(.+?)\]/gi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    followUps.push(match[1].trim());
  }
  // Remove the follow-up tags from the main answer
  const cleanAnswer = text.replace(/\[FOLLOW_UP:\s*.+?\]/gi, "").trim();
  return { cleanAnswer, followUps };
}

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", upload.single("file"), async (req, res) => {
  try {
    const { question, mode, plan, history: historyRaw } = req.body;

    // Select model based on user's plan
    let selectedModel = "gpt-4.1-mini"; // Default free
    if (plan === "go") selectedModel = "gpt-4.1";
    if (plan === "plus" || plan === "pro") selectedModel = "gpt-5.2";
    console.log(`[ASK] User plan: ${plan || 'free'} -> using model: ${selectedModel}`);

    // Parse conversation history sent from frontend
    let history = [];
    try {
      history = historyRaw ? JSON.parse(historyRaw) : [];
    } catch {
      history = [];
    }
    // Build OpenAI-formatted prior turns (exclude the current question — it's added below)
    const historyTurns = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    if (historyTurns.length > 0) {
      console.log(`[ASK] Using ${historyTurns.length} history turns for context`);
    }

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
    let tokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    /* ---------- LIVE MODE ---------- */
    if (mode === "LIVE") {
      if (req.file) {
        return res.json({
          answer:
            "Current Updates mode does not support document or image analysis. Please switch to PMC Expert Mode or General AI Assistant."
        });
      }

      const r = await openai.responses.create({
        model: selectedModel,
        tools: [{ type: "web_search" }],
        input: [
          { role: "system", content: LIVE_SYSTEM_INSTRUCTION },
          ...historyTurns,
          { role: "user", content: question }
        ],
        max_output_tokens: 1000
      });

      answer = r.output_text || "";

      // Extract token usage
      if (r.usage) {
        tokenUsage = {
          inputTokens: r.usage.input_tokens || 0,
          outputTokens: r.usage.output_tokens || 0,
          totalTokens: (r.usage.input_tokens || 0) + (r.usage.output_tokens || 0),
        };
      }
    }

    /* ---------- PMC MODE ---------- */
    else if (mode === "PMC") {
      // Search the knowledge base for relevant context
      console.log(`[ASK] PMC question received: "${question.slice(0, 80)}..."`);
      const kbContext = await searchKB(question);

      let systemWithKB = PMC_SYSTEM_INSTRUCTION;
      if (kbContext) {
        systemWithKB += `

KNOWLEDGE BASE CONTEXT (use this as your primary source):
${kbContext}`;
        console.log("[ASK] KB context injected into prompt");
      } else {
        console.log("[ASK] No KB context found — answering from general knowledge");
      }

      const userContent = uploadedText
        ? `UPLOADED MATERIAL:\n${uploadedText}\n\nTECHNICAL QUESTION:\n${question}`
        : question;

      const r = await openai.responses.create({
        model: selectedModel,
        input: [
          { role: "system", content: systemWithKB },
          ...historyTurns,
          { role: "user", content: userContent }
        ],
        max_output_tokens: 2400
      });

      answer = finalizeAnswer(r.output_text);
      console.log(`[ASK] PMC answer generated (${answer.length} chars)`);

      if (r.usage) {
        tokenUsage = {
          inputTokens: r.usage.input_tokens || 0,
          outputTokens: r.usage.output_tokens || 0,
          totalTokens: (r.usage.input_tokens || 0) + (r.usage.output_tokens || 0),
        };
      }
    }

    /* ---------- GENERAL MODE ---------- */
    else {
      const r = await openai.responses.create({
        model: selectedModel,
        input: [
          { role: "system", content: GENERAL_SYSTEM_INSTRUCTION },
          ...historyTurns,
          {
            role: "user",
            content: uploadedText
              ? `DOCUMENT CONTENT:\n${uploadedText}\n\nQUESTION:\n${question}`
              : question
          }
        ],
        max_output_tokens: 1000
      });

      answer = finalizeAnswer(r.output_text);

      if (r.usage) {
        tokenUsage = {
          inputTokens: r.usage.input_tokens || 0,
          outputTokens: r.usage.output_tokens || 0,
          totalTokens: (r.usage.input_tokens || 0) + (r.usage.output_tokens || 0),
        };
      }
    }

    if (!answer || answer.length < 15) {
      answer =
        "I need a bit more information to give you a precise answer. Could you please clarify your requirement?";
    }

    // Extract follow-up suggestions from the answer
    const { cleanAnswer, followUps } = extractFollowUps(answer);

    console.log(`[ASK] Tokens: in=${tokenUsage.inputTokens} out=${tokenUsage.outputTokens} total=${tokenUsage.totalTokens}`);
    console.log(`[ASK] Follow-ups extracted: ${followUps.length}`);
    res.json({ answer: cleanAnswer, tokenUsage, followUps });

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
