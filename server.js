import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ===============================
   PROMPTS
   =============================== */

const INTENT_PROMPT =
  "Classify the following user question.\n" +
  "Answer with ONE WORD ONLY:\n" +
  "PMC or GENERAL\n\n" +
  "User question:\n";

const ANSWER_PROMPT =
  "You are PMC CENTRE AI.\n" +
  "Rules:\n" +
  "- Plain text only\n" +
  "- No markdown\n" +
  "- No asterisks\n\n" +
  "User question:\n";

/* ===============================
   ASK ENDPOINT
   =============================== */

app.post("/ask", async (req, res) => {
  const question =
    req.body.question ||
    req.body.prompt ||
    req.body.text ||
    "";

  if (!question.trim()) {
    return res.json({ answer: "No question received." });
  }

  try {
    console.log("CALL 1 START — INTENT");

    const intentResponse = await client.responses.create({
      model: "gpt-5.2", // DO NOT CHANGE YET
      input: INTENT_PROMPT + question,
      max_output_tokens: 5,
    });

    const intent =
      intentResponse.output_text?.toUpperCase().includes("PMC")
        ? "PMC"
        : "GENERAL";

    console.log("CALL 1 OK — INTENT:", intent);

    console.log("CALL 2 START — ANSWER");

    const answerResponse = await client.responses.create({
      model: "gpt-4.1-mini", // DO NOT CHANGE YET
      input: ANSWER_PROMPT + question,
      max_output_tokens: 600,
    });

    const answer =
      answerResponse.output_text || "No answer returned.";

    console.log("CALL 2 OK — ANSWER");

    res.json({ intent, answer });

  } catch (err) {
    console.error("❌ OPENAI ERROR MESSAGE:", err.message);
    console.error("❌ OPENAI ERROR STACK:", err.stack);
    console.error("❌ FULL ERROR OBJECT:", JSON.stringify(err, null, 2));

    res.status(500).json({
      answer: "Backend error occurred. Please check Render logs.",
    });
  }
});

/* ===============================
   HEALTH
   =============================== */

app.get("/", (_, res) => {
  res.send("PMC CENTRE AI backend running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
