import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    console.log("OPENAI CALL START");

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: question,
    });

    const answer =
      response.output_text ||
      "No output returned from OpenAI.";

    res.json({ answer });
  } catch (err) {
    console.error("OPENAI ERROR FULL:", err);
    res.json({
      answer:
        "Backend error occurred. Check Render logs for details.",
    });
  }
});

app.get("/", (req, res) => {
  res.send("PMC CENTRE AI diagnostic backend running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
