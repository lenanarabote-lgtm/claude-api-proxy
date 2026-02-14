import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { type, question, topic, prompt } = req.body;

    if (type === 'generate') {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt || `Сгенерируй урок по теме: ${topic}`,
          },
        ],
      });

      const text = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const lesson = JSON.parse(cleaned);
        return res.status(200).json({ lesson });
      } catch (parseError) {
        return res.status(200).json({ answer: text });
      }

    } else if (type === 'answer') {
      const systemPrompt = `Ты опытный математический репетитор. Отвечай кратко, понятно, на русском языке. 
Формулы пиши СЛОВАМИ (как произносишь вслух): "икс в квадрате", "корень из дэ" и т.д.
Контекст урока: ${topic}`;

      const message = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: question,
          },
        ],
      });

      const answer = message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('');

      return res.status(200).json({ answer });

    } else {
      return res.status(400).json({ error: 'Invalid type. Use "generate" or "answer".' });
    }

  } catch (error) {
    console.error('Claude API error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
