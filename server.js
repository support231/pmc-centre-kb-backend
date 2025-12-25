import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ===============================
   PROMPTS (PLAIN STRING ONLY)
   =============================== */

const INTENT_PROMPT_PREFIX =
  "Classify the following user question.\n\n" +
  "If it is related to:\n" +
  "- Paper Machine Clothing\n" +
  "- Papermaking technology\n" +
  "- Paper machine sections\n" +
  "- Paper industry engineering\n\n" +
  "Answer with ONE WORD ONLY:\n" +
  "PMC\n" +
  "or\n" +
  "GENERAL\n\n" +
  "User question:\n";

const ANSWER_PROMPT_PREFIX =
  "You are PMC CENTRE AI.\n\n" +
  "Rules:\n" +
  "- Answer clearly and professionally.\n" +
  "- Use plain text only.\n" +
  "- Do NOT use markdown.\n" +
  "- Do NOT use asterisks.\n" +
  "- Do NOT use bullet symbols.\n\n" +
  "User question:\n";

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", async (req, res) => {
  try {
    const question =
      req.body.question ||
      req.body.prompt ||
      req.body.text ||
      "";

    if (!question.trim()) {
      return res.json({ answer: "No question received." });
    }

    /* ========= CALL 1: INTENT ========= */
    console.log("OPENAI CALL #1 — INTENT START");

    const intentResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: INTENT_PROMPT_PREFIX + question,
      max_output_tokens: 5,
    });

    const intentText =
      intentResponse.output_text?.trim() || "GENERAL";

    const intent =
      intentText.toUpperCase().includes("PMC")
        ? "PMC"
        : "GENERAL";

    console.log("OPENAI CALL #1 — INTENT RESULT:", intent);

    /* ========= CALL 2: ANSWER ========= */
    console.log("OPENAI CALL #2 — ANSWER START");

    const answerResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: ANSWER_PROMPT_PREFIX + question,
      max_output_tokens: 600,
    });

    const answer =
      answerResponse.output_text?.trim() ||
      "No answer returned from OpenAI.";

    console.log("OPENAI CALL #2 — ANSWER COMPLETE");

    res.json({
      intent,
      answer,
    });

  } catch (err) {
    console.error("FULL BACKEND ERROR:", err);
    res.status(500).json({
      answer: "Backend error occurred. Please check Render logs.",
    });
  }
});

/* ===============================
   HEALTH CHECK
   =============================== */

app.get("/", (req, res) => {
  res.send("PMC CENTRE AI backend running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
