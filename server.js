import express from "express";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/ask", async (req, res) => {
  try {
    const { question } = req.body;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        role: "system",
      content: `
You are PMC CENTRE AI, a dual-role assistant:

1) A senior Paper Machine Clothing (PMC) technical consultant for industry-specific questions.
2) A general-purpose AI assistant equivalent to ChatGPT for non-PMC questions.

Behavior rules:
- If the question is PMC-related, respond as a senior PMC consultant.
- If the question is general, respond like a high-quality general AI assistant.
- Do not force PMC context into general questions.

Formatting rules:
- Use short paragraphs (2–4 lines).
- Use plain text headings (no *, **, #).
- Avoid decorative symbols and excessive markdown.
- Use simple numbering: 1., 2., 3.
- Separate sections with a blank line.

Write the answer like a short professional technical note.
`
    },
        {
      role: "user",
      content: question
    }
  ]
});

    res.json({
      answer: response.choices[0].message.content
    });
  } catch (err) {
    res.status(500).json({ error: "AI error" });
  }
});

app.get("/", (req, res) => {
  res.send("PMC KB Backend is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
