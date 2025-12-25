import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ===============================
   PROMPTS (MINIMAL)
   =============================== */

const INTENT_PROMPT = `
Is the following question related to Paper Machine Clothing or papermaking technology?
Answer with ONLY ONE WORD:
PMC or GENERAL
`;

const ANSWER_PROMPT = `
You are PMC CENTRE AI.
Answer the user question clearly and professionally.
Plain text only.
`;

/* ===============================
   ASK ENDPOINT (DIAGNOSTIC)
   =============================== */

app.post("/ask", async (req, res) => {
  try {
    // Be forgiving about input key
    const question =
      req.body.question ||
      req.body.prompt ||
      req.body.text ||
      "";

    if (!question) {
      return res.json({
        answer: "No question received by backend.",
      });
    }

    /* ---- CALL 1: INTENT DETECTION ---- */
    console.log("INTENT CALL START");

    const intentResponse = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: INTENT_PROMPT },
        { role: "user", content: question },
      ],
      max_tokens: 5,
    });

    const intent =
      intentResponse.choices?.[0]?.message?.content || "UNKNOWN";

    console.log("INTENT RESULT:", intent);

    /* ---- CALL 2: ANSWER GENERATION ---- */
    console.log("ANSWER CALL START");

    const answerResponse = await client.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        { role: "system", content: ANSWER_PROMPT },
        { role: "user", content: question },
      ],
    });

    const answer =
      answerResponse.choices?.[0]?.message?.content ||
      "Answer generation failed.";

    res.json({
      intent: intent.trim(),
      answer,
    });
  } catch (err) {
    console.error("ERROR:", err);
    res.json({
      answer:
        "Backend error occurred. Check Render logs.",
    });
  }
});

/* ===============================
   HEALTH CHECK
   =============================== */

app.get("/", (req, res) => {
  res.send("PMC CENTRE AI diagnostic backend running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
