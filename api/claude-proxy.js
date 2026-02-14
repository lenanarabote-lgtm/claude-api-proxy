module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
      .filter(function(b) { return b.type === 'text'; })
      .map(function(b) { return b.text; })
      .join('');
  }

  try {
    var type = req.body.type;
    var question = req.body.question;
    var topic = req.body.topic;
    var prompt = req.body.prompt;

    if (type === 'generate') {
      var teacherSystem = 'Ты Марина Сергеевна, репетитор математики, 35 лет, кандидат наук. Ты ведёшь живой урок с учеником-подростком.\n\nСгенерируй урок как МАССИВ СЕГМЕНТОВ. Каждый сегмент — это либо объяснение, либо вопрос ученику.\n\nОтветь СТРОГО в JSON без markdown-обёрток:\n[\n  {\n    "type": "explain",\n    "speech": "Текст для озвучки. Короткий, 2-3 предложения.",\n    "board": [{"type": "text", "content": "📌 Заголовок"}, {"type": "formula", "content": "LaTeX"}]\n  },\n  {\n    "type": "question",\n    "speech": "Конкретный вопрос ученику с числами. 1 предложение.",\n    "board": [{"type": "formula", "content": "LaTeX если нужна"}],\n    "hint": "Подсказка-направление, НЕ ответ",\n    "answer": "Правильный ответ кратко"\n  }\n]\n\nПРАВИЛА:\n- 5-8 сегментов\n- Чередуй explain и question\n- ВОПРОСЫ КОНКРЕТНЫЕ с числами\n- speech: разговорный стиль, формулы словами\n- НЕ начинай с приветствия\n- Обязательно числовой пример\n- JSON валидный';

      var text = await callClaude(teacherSystem, prompt || 'Тема: ' + topic, 4096);

      var segments = [];
      try {
        var cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        segments = JSON.parse(cleaned);
        if (!Array.isArray(segments)) segments = [];
      } catch (e) {
        console.error('Segments parse error:', e);
      }

      return res.status(200).json({ segments: segments });
    }

    if (type === 'evaluate') {
      var studentAnswer = question;
      var questionSpeech = req.body.questionSpeech || '';
      var correctAnswer = req.body.correctAnswer || '';
      var hintText = req.body.hint || '';
      var attemptNumber = req.body.attemptNumber || 1;

      var sys = 'Ты Марина Сергеевна, репетитор. Ученик ответил на вопрос.\n\nОтветь в JSON:\n{"status": "correct" или "hint" или "explain", "reaction": "1-2 предложения"}\n\nПравила:\n1. Правильный ответ: {"status": "correct", "reaction": "Короткая похвала"}\n2. Неверный, попытка 1-2: {"status": "hint", "reaction": "Наводящий вопрос"}\n3. Не знаю или попытка 3: {"status": "explain", "reaction": "Краткое объяснение с ответом"}\n- Формулы словами\n- Сразу к делу\n- JSON валидный\n\nТема: ' + topic;

      var evalInput = 'Вопрос: ' + questionSpeech + '\nПравильный ответ: ' + correctAnswer + '\nПодсказка: ' + hintText + '\nПопытка: ' + attemptNumber + '\nОтвет ученика: ' + studentAnswer;

      var evalText = await callClaude(sys, evalInput, 512, 'claude-haiku-4-5-20251001');

      try {
        var cleanedEval = evalText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        var parsed = JSON.parse(cleanedEval);
        return res.status(200).json(parsed);
      } catch (e) {
        return res.status(200).json({ status: 'explain', reaction: evalText });
      }
    }

    if (type === 'answer_with_board') {
      var teacherSys = 'Ты Марина Сергеевна, репетитор. Ученик задал вопрос.\n\nСократический метод: наводящий вопрос, не готовый ответ.\n- НЕ повторяй вопрос\n- 2-3 предложения\n- В конце: "Ясно? Продолжим?"\n- Просто текст\n\nКонтекст: ' + topic;

      var teacherAnswer = await callClaude(teacherSys, question, 1024);

      var boardSys = 'Нужны ли формулы на доске? Если да — JSON массив, если нет — []. Макс 1-3 элемента. Только JSON.';
      var answerBoard = [];
      try {
        var br = await callClaude(boardSys, 'Вопрос: ' + question + '\nОтвет: ' + teacherAnswer, 512, 'claude-haiku-4-5-20251001');
        var cb = br.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        answerBoard = JSON.parse(cb);
        if (!Array.isArray(answerBoard)) answerBoard = [];
      } catch (e) {}

      return res.status(200).json({ answer: teacherAnswer, board: answerBoard });
    }

    if (type === 'answer') {
      var s = 'Ты Марина Сергеевна, репетитор. Сократический метод. Формулы словами. Контекст: ' + topic;
      var a = await callClaude(s, question, 1024);
      return res.status(200).json({ answer: a });
    }

    return res.status(400).json({ error: 'Invalid type' });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
