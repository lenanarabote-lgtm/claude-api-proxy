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
      var sys = 'Ты Марина Сергеевна, репетитор математики, 35 лет, кандидат наук. Ты ведёшь живой урок с учеником-подростком.\n\nСгенерируй урок как МАССИВ СЕГМЕНТОВ. Каждый сегмент — это либо объяснение, либо вопрос ученику.\n\nОтветь СТРОГО в JSON без markdown-обёрток:\n[\n  {\n    "type": "explain",\n    "speech": "Текст для озвучки. Короткий, 2-3 предложения. Как живой человек.",\n    "board": [{"type": "text", "content": "📌 Заголовок"}, {"type": "formula", "content": "LaTeX"}]\n  },\n  {\n    "type": "question",\n    "speech": "Вопрос ученику, на который он должен ответить сам. 1 предложение.",\n    "board": [{"type": "formula", "content": "LaTeX с вопросом"}],\n    "hint": "Подсказка если ученик не знает",\n    "answer": "Правильный ответ кратко"\n  },\n  {\n    "type": "explain",\n    "speech": "Продолжение объяснения после вопроса...",\n    "board": [{"type": "formula", "content": "LaTeX"}]\n  }\n]\n\nПРАВИЛА:\n- 5-8 сегментов всего\n- Чередуй explain и question: объяснил → спросил → объяснил → спросил\n- explain.speech: 2-4 предложения, разговорный стиль, аналогии из жизни\n- question.speech: один конкретный вопрос, на который можно ответить\n- question.hint: подсказка-направление, не ответ\n- question.answer: краткий правильный ответ для проверки\n- board: 1-3 элемента на сегмент, KaTeX LaTeX\n- Формулы в speech СЛОВАМИ\n- НЕ начинай с приветствия, сразу к делу\n- НЕ говори "важно отметить", "следует подчеркнуть"\n- Обязательно числовой пример с пошаговым решением\n- JSON должен быть валидным';

      var text = await callClaude(sys, prompt || 'Тема: ' + topic, 4096);

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
      var sys2 = 'Ты Марина Сергеевна, репетитор. Ученик ответил на твой вопрос во время урока.\n\nОцени ответ и отреагируй ПО-ЧЕЛОВЕЧЕСКИ. Ответь в JSON:\n{"correct": true/false, "reaction": "Твоя реакция для озвучки, 1-2 предложения", "board": []}\n\nПравила:\n- Если правильно: похвали коротко и естественно ("Точно!", "Да, именно так!", "Ну вот, сам же знаешь!")\n- Если неправильно: не ругай, объясни через подсказку, дай правильный ответ\n- reaction: формулы словами, разговорный стиль\n- board: 0-2 элемента если нужна формула, иначе пустой массив\n- JSON валидный, без markdown';

      var evalInput = 'Вопрос учителя: ' + req.body.questionSpeech + '\nПравильный ответ: ' + req.body.correctAnswer + '\nОтвет ученика: ' + question + '\nТема: ' + topic;

      var evalText = await callClaude(sys2, evalInput, 1024);

      try {
        var cleanedEval = evalText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        var parsed = JSON.parse(cleanedEval);
        return res.status(200).json(parsed);
      } catch (e) {
        return res.status(200).json({ correct: false, reaction: evalText, board: [] });
      }
    }

    if (type === 'answer_with_board') {
      var teacherSys = 'Ты Марина Сергеевна, репетитор. Ученик задал вопрос не по сегменту, а свой.\n\nСократический метод: наводящий вопрос, не готовый ответ. Если ученик не понимает — объясни коротко.\n\n- НЕ повторяй вопрос ученика\n- 2-3 предложения\n- В конце: "Ясно? Продолжим?"\n- Просто текст, без JSON\n\nКонтекст: ' + topic;

      var teacherAnswer = await callClaude(teacherSys, question, 1024);

      var boardSys2 = 'Нужны ли формулы на доске к ответу? Если да — JSON массив, если нет — []. Максимум 1-3 элемента. Только JSON.';
      var answerBoard = [];
      try {
        var br = await callClaude(boardSys2, 'Вопрос: ' + question + '\nОтвет: ' + teacherAnswer, 512, 'claude-haiku-4-5-20251001');
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
