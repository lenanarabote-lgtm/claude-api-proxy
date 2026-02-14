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

    let messages = [];
    let system = undefined;
    let maxTokens = 1024;

    if (type === 'generate') {
      maxTokens = 4096;
      messages = [{ role: 'user', content: prompt || 'Сгенерируй урок по теме: ' + topic }];

    } else if (type === 'answer_with_board') {
      maxTokens = 2048;
      system = 'Ты опытный математический репетитор. Ученик задал вопрос во время урока. Ответь на вопрос И дай элементы для записи на доске.\n\nОтветь СТРОГО в JSON без markdown-обёрток:\n{"answer": "Текстовый ответ словами для озвучки, без LaTeX. В конце обязательно скажи: Понятно? Продолжаем?", "board": [{"type": "formula", "content": "LaTeX формула"}, {"type": "text", "content": "пояснение"}]}\n\nПравила:\n- "answer" — только слова для озвучки, формулы произноси словами\n- "board" — 2-5 элементов: ключевые формулы и пояснения к ответу\n- Для "formula" используй KaTeX LaTeX\n- JSON должен быть валидным\n- В конце ответа ВСЕГДА спроси: Понятно? Продолжаем?\n\nКонтекст урока: ' + topic;
      messages = [{ role: 'user', content: question }];

    } else if (type === 'answer') {
      system = 'Ты опытный математический репетитор. Отвечай кратко, понятно, на русском языке. Формулы пиши СЛОВАМИ (как произносишь вслух). Контекст урока: ' + topic;
      messages = [{ role: 'user', content: question }];

    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: messages,
    };
    if (system) body.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return res.status(500).json({ error: 'Anthropic API error', details: err });
    }

    const data = await response.json();
    const text = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (type === 'generate') {
      try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const lesson = JSON.parse(cleaned);
        return res.status(200).json({ lesson });
      } catch (parseError) {
        return res.status(200).json({ answer: text });
      }
    }

    if (type === 'answer_with_board') {
      try {
        const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return res.status(200).json({
          answer: parsed.answer || text,
          board: parsed.board || [],
        });
      } catch (parseError) {
        return res.status(200).json({ answer: text, board: [] });
      }
    }

    return res.status(200).json({ answer: text });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
