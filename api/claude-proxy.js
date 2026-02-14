module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  async function callClaude(system, userMessage, maxTokens, model) {
    var body = {
      model: model || 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userMessage }],
    };
    if (system) body.system = system;

    var response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      var err = await response.text();
      throw new Error('Anthropic API error: ' + err);
    }

    var data = await response.json();
    return data.content
      .filter(function(block) { return block.type === 'text'; })
      .map(function(block) { return block.text; })
      .join('');
  }

  try {
    var type = req.body.type;
    var question = req.body.question;
    var topic = req.body.topic;
    var prompt = req.body.prompt;

    if (type === 'generate') {
      var teacherSystem = 'Ты Марина Сергеевна — репетитор по математике, 35 лет, кандидат наук. Ты живая, с юмором, используешь сократический метод.\n\nСгенерируй ТОЛЬКО текст объяснения для озвучки вслух по теме, которую укажет пользователь.\n\nПравила:\n- Начни коротко: "Так, сегодня разбираем..."\n- Говори КАК ЧЕЛОВЕК, короткие предложения\n- Задавай вопросы по ходу: "А как думаешь, что будет если...? Правильно!"\n- Чередуй: мысль → вопрос → ответ → следующая мысль\n- Аналогии из жизни обязательно\n- Разбери пример с числами, спрашивая "что дальше?"\n- Формулы СЛОВАМИ: "икс в квадрате", "дэ равно бэ квадрат минус четыре а цэ"\n- 1-2 минуты речи максимум\n- Без LaTeX, без спецсимволов, без JSON\n- Просто текст для озвучки, ничего больше';

      var boardSystem = 'Ты ассистент-конспектист. Твоя задача — составить ИДЕАЛЬНЫЙ конспект для доски по математической теме.\n\nОтветь СТРОГО в JSON без markdown-обёрток:\n[\n  { "type": "text", "content": "📌 Заголовок" },\n  { "type": "formula", "content": "LaTeX формула" }\n]\n\nПравила:\n- 8-12 элементов\n- Чередуй text и formula\n- KaTeX-совместимый LaTeX для формул\n- text: короткие фразы с эмодзи 📌 🔑 ✨ 📝 🎯 🤔\n- Добавляй вопросы: "🤔 Что если D = 0?"\n- Обязательно числовой пример с пошаговым решением\n- ПОЛНЫЙ конспект от начала до конца\n- Только JSON массив, ничего больше';

      var topicText = prompt || 'Тема: ' + topic;

      var results = await Promise.all([
        callClaude(teacherSystem, topicText, 2048),
        callClaude(boardSystem, topicText, 2048, 'claude-haiku-4-5-20241001'),
      ]);

      var teacherText = results[0];
      var boardText = results[1];

      var board = [];
      try {
        var cleaned = boardText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
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

    if (type === 'answer_wit
