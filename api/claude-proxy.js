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

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  async function callClaude(system, userMessage, maxTokens, model) {
    const body = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userMessage }],
    };
    if (system) body.system = system;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error('Anthropic API error: ' + err);
    }

    const data = await response.json();
    return data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
  }

  try {
    const { type, question, topic, prompt } = req.body;

    // ===== ГЕНЕРАЦИЯ УРОКА: два агента параллельно =====
    if (type === 'generate') {
      const teacherSystem = `Ты Марина Сергеевна — репетитор по математике, 35 лет, кандидат наук. Ты живая, с юмором, используешь сократический метод.

Сгенерируй ТОЛЬКО текст объяснения для озвучки вслух по теме, которую укажет пользователь.

Правила:
- Начни коротко: "Так, сегодня разбираем..."
- Говори КАК ЧЕЛОВЕК, короткие предложения
- Задавай вопросы по ходу: "А как думаешь, что будет если...? Правильно!"
- Чередуй: мысль → вопрос → ответ → следующая мысль
- Аналогии из жизни обязательно
- Разбери пример с числами, спрашивая "что дальше?"
- Формулы СЛОВАМИ: "икс в квадрате", "дэ равно бэ квадрат минус четыре а цэ"
- 1-2 минуты речи максимум
- Без LaTeX, без спецсимволов, без JSON
- Просто текст для озвучки, ничего больше`;

      const boardSystem = `Ты ассистент-конспектист. Твоя задача — составить ИДЕАЛЬНЫЙ конспект для доски по математической теме.

Ответь СТРОГО в JSON без markdown-обёрток:
[
  { "type": "text", "content": "📌 Заголовок" },
  { "type": "formula", "content": "LaTeX формула" },
  ...
]

Правила:
- 8-12 элементов
- Чередуй text и formula
- KaTeX-совместимый LaTeX для формул (\\frac, \\sqrt, \\int, \\sum)
- text: короткие фразы с эмодзи 📌 🔑 ✨ 📝 🎯 🤔
- Добавляй вопросы: "🤔 Что если D = 0?"
- Обязательно числовой пример с пошаговым решением
- ПОЛНЫЙ конспект от начала до конца
- Только JSON массив, ничего больше`;

      const topicText = prompt || 'Тема: ' + topic;

      const [teacherText, boardText] = await Promise.all([
        callClaude(teacherSystem, topicText, 2048),
        callClaude(boardSystem, topicText, 2048, 'claude-haiku-4-5-20241001'),
      ]);

      let board = [];
      try {
        const cleaned = boardText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        board = JSON.parse(cleaned);
        if (!Array.isArray(board)) board = [];
      } catch (e) {
        console.error('Board parse error:', e);
      }

      return res.status(200).json({
        lesson: {
          explanation: teacherText,
          board: board,
        },
      });
    }

    // ===== ОТВЕТ НА ВОПРОС: два агента последовательно =====
    if (type === 'answer_with_board') {
      const teacherSystem = `Ты Марина Сергеевна — репетитор по математике. Ученик прервал тебя вопросом.

ГЛАВНОЕ: сократический метод. НЕ давай готовый ответ. Сначала наводящий вопрос, подсказка. Только если ученик говорит "не знаю" — объясни.

Примеры:
- "Как найти дискриминант?" → "А какие три коэффициента есть в уравнении? Что с ними делаем?"
- "Не понимаю производную" → "Представь спидометр в машине — он показывает скорость. Производная это и есть скорость функции"

Правила:
- 2-4 предложения максимум
- Формулы словами
- В конце: "Понятно? Продолжаем?" или похожее
- Просто текст, без JSON, без LaTeX

Контекст урока: ${topic}`;

      const teacherAnswer = await callClaude(teacherSystem, question, 1024);

      const boardSystem = `Ты конспектист. Учитель ответил на вопрос ученика. Нужны ли формулы на доске к этому ответу?

Если да — верни JSON массив:
[{"type": "formula", "content": "LaTeX"}, {"type": "text", "content": "пояснение"}]

Если формулы не нужны — верни пустой массив: []

Максимум 1-3 элемента. Только JSON, ничего больше.`;

      let board = [];
      try {
        const boardText = await callClaude(
          boardSystem,
          'Вопрос: ' + question + '\nОтвет учителя: ' + teacherAnswer,
          512,
          'claude-haiku-4-5-20241001'
        );
        const cleaned = boardText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        board = JSON.parse(cleaned);
        if (!Array.isArray(board)) board = [];
      } catch (e) {
        console.error('Board parse error:', e);
      }

      return res.status(200).json({ answer: teacherAnswer, board: board });
    }

    // ===== ПРОСТОЙ ОТВЕТ (совместимость) =====
    if (type === 'answer') {
      const system = `Ты Марина Сергеевна — репетитор. Сократический метод. Не давай готовых ответов, задавай наводящие вопросы. Формулы словами. Контекст: ${topic}`;
      const answer = await callClaude(system, question, 1024);
      return res.status(200).json({ answer });
    }

    return res.status(400).json({ error: 'Invalid type' });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}
```
