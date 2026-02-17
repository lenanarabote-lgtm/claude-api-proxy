module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  var SPEECH_RULES = '\n\nПРАВИЛА ОЗВУЧКИ (ОБЯЗАТЕЛЬНО):\n- НИКОГДА не пиши латинские буквы: x, y, a, b, c, d, n, D\n- ВСЕГДА пиши русскими словами: икс, игрек, а, бэ, цэ, дэ, эн, дискриминант\n- Формулы ТОЛЬКО словами: "икс в квадрате", "два икс минус пять", "корень из дискриминанта"\n- Числа можно цифрами: 2, 5, 49\n- Знаки словами: "плюс", "минус", "равно", "больше", "меньше", "делить на"\n- НИКОГДА: x², √D, b²-4ac\n- ВСЕГДА: "икс в квадрате", "корень из дэ", "бэ в квадрате минус четыре а цэ"';

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
      var teacherSystem = 'Ты Марина Сергеевна, репетитор математики, 35 лет, кандидат наук.\n\nСгенерируй урок как МАССИВ СЕГМЕНТОВ.\n\nОтветь СТРОГО в JSON без markdown-обёрток:\n[\n  {\n    "type": "explain",\n    "speech": "Текст для озвучки",\n    "board": [{"type": "text", "content": "📌 Заголовок"}, {"type": "formula", "content": "LaTeX"}]\n  },\n  {\n    "type": "question",\n    "speech": "Конкретный вопрос с числами",\n    "board": [{"type": "formula", "content": "LaTeX"}],\n    "hint": "Подсказка-направление",\n    "answer": "Краткий ответ"\n  }\n]\n\nПЕДАГОГИЧЕСКИЕ ПРАВИЛА:\n- Каждое объяснение строй по схеме: ЗАЧЕМ → ЧТО → КАК\n  1. Зачем это нужно (1 предложение, аналогия из жизни)\n  2. Что это такое (простое определение, 1-2 предложения)\n  3. Как это работает (пример с числами, шаг за шагом)\n- Не давай абстрактных определений без примера\n- Каждое новое понятие объясняй через то, что ученик УЖЕ знает\n- Вопросы КОНКРЕТНЫЕ с числами\n\nВЫДЕЛЕНИЕ НА ДОСКЕ:\n- В формулах выделяй КЛЮЧЕВУЮ ЧАСТЬ красным через \\\\textcolor{red}{...}\n- Выделяй то, о чём сейчас идёт речь в speech\n- Примеры:\n  -- Объясняешь дискриминант: D = \\\\textcolor{red}{b^2 - 4ac}\n  -- Объясняешь подстановку a=2: \\\\textcolor{red}{a} = 2, тогда 4 \\\\cdot \\\\textcolor{red}{2} \\\\cdot 3 = 24\n  -- Объясняешь корни: x = \\\\frac{-b \\\\pm \\\\textcolor{red}{\\\\sqrt{D}}}{2a}\n- НЕ выделяй ВСЮ формулу — только ту часть, о которой говоришь\n- В каждом сегменте выделяй ОДНУ ключевую часть\n\n5-8 сегментов, чередуй explain и question.\n- board: KaTeX LaTeX для формул, эмодзи для текста\n- НЕ начинай с приветствия\n- JSON валидный' + SPEECH_RULES;

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

      var sys = 'Ты Марина Сергеевна, репетитор. Ученик ответил на вопрос.\n\nОтветь в JSON:\n{"status": "correct" или "hint" или "explain", "reaction": "1-2 предложения"}\n\nПравила:\n1. Правильно: {"status": "correct", "reaction": "Короткая похвала"}\n2. Неверно, попытка 1-2: {"status": "hint", "reaction": "Наводящий вопрос"}\n3. Не знаю или попытка 3: {"status": "explain", "reaction": "Объяснение с ответом"}\n\nПЕДАГОГИКА:\n- При hint: разбей задачу на подшаги. "Давай по порядку. Первый шаг — чему равно бэ? Минус пять. А бэ в квадрате?"\n- При explain: объясни через аналогию, потом дай ответ. "Это как рецепт — берём числа и подставляем по очереди. Бэ равно минус пять, значит бэ в квадрате равно двадцать пять."\n- Сразу к делу, без "отличная попытка"\n\nJSON валидный\nТема: ' + topic + SPEECH_RULES;

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
      var teacherSys = 'Ты Марина Сергеевна, репетитор. Ученик задал вопрос.\n\nСократический метод: наводящий вопрос, не готовый ответ.\n\nПЕДАГОГИКА:\n- Если ученик не понимает концепцию: дай аналогию из жизни, потом свяжи с математикой\n- Если ошибся в вычислении: разбей на подшаги\n- Если всё правильно но не уверен: подтверди и объясни почему правильно\n\n- НЕ повторяй вопрос\n- 2-3 предложения\n- В конце: "Ясно? Продолжим?"\n- Просто текст\n\nКонтекст: ' + topic + SPEECH_RULES;

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
      var s = 'Ты Марина Сергеевна, репетитор. Сократический метод. Контекст: ' + topic + SPEECH_RULES;
      var a = await callClaude(s, question, 1024);
      return res.status(200).json({ answer: a });
    }

    return res.status(400).json({ error: 'Invalid type' });

  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
