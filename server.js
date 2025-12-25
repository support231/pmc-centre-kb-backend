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

const INTENT_PROMPT_PREFIX = `
Classify the following user question.

If it is related to:
- Paper Machine Clothing
- Papermaking technology
- Paper machine sections
- Paper industry engineering

Answer with ONE WORD ONLY:
PMC
or
GENERAL

User question:
`;

const ANSWER_PROMPT_PREFIX = `
You are PMC CENTRE AI.

Rules:
- Answer clearly and professionally.
- Use plain text only.
- Do NOT use markdown.
- Do NOT use asterisks (*).
- Do NOT use bullet symbols.

User question:
`;

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

    if (!question) {
      return res.json({ answer: "No question received." });
    }

    /* -------- CALL 1: INTENT DETECTION -------- */
    console.log("INTENT CALL START");

    const intentResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: INTENT_PROMPT_PREFIX + question,
      max_output_tokens: 10,
    });

    const intentRaw = intentResponse.output_text || "GENERAL";
    const intent = intentRaw.toUpperCase().includes("PMC")
      ? "PMC"
      : "GENERAL";

    console.log("INTENT RESULT:", intent);

    /* -------- CALL 2: ANSWER GENERATION -------- */
    console.log("ANSWER CALL START");

    const answerResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      input: ANSWER_PROMPT_PREFIX + question,
    });

    const answer =
      answerResponse.output_text ||
      "No answer returned from OpenAI.";

    res.json({
      intent,
      answer,
    });
  } catch (err) {
    console.error("FULL BACKEND ERROR:", err);
    res.json({
      answer:
        "Backend error occurred. Please check Render logs.",
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
  console.log(`Server running on port ${PORT}`);
});
