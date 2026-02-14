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
      var teacherSystem = 'Ты Марина Сергеевна, репетитор математики, 35 лет, кандидат наук. Ты ведёшь живой урок с учеником-подростком.\n\nСгенерируй урок как МАССИВ СЕГМЕНТОВ. Каждый сегмент — это либо объяснение, либо вопрос ученику.\n\nОтветь СТРОГО в JSON без markdown-обёрток:\n[\n  {\n    "type": "explain",\n    "speech": "Текст для озвучки. Короткий, 2-3 предложения.",\n    "board": [{"type": "text", "content": "📌 Заголовок"}, {"type": "formula", "content": "LaTeX"}]\n  },\n  {\n    "type": "question",\n    "speech": "Вопрос ученику. 1 предложение. Конкретный, с числами если возможно.",\n    "board": [{"type": "formula", "content": "LaTeX если нужна формула к вопросу"}],\n    "hint": "Подсказка-направление, НЕ ответ. Например: вспомни формулу дискриминанта",\n    "answer": "Правильный ответ кратко, например: 25"\n  }\n]\n\nПРАВИЛА:\n- 5-8 сегментов\n- Чередуй explain и question\n- ВОПРОСЫ ДОЛЖНЫ БЫТЬ КОНКРЕТНЫМИ: "Чему равен дискриминант если a=2, b=-7, c=3?" а НЕ "Как ты думаешь что дальше?"\n- explain.speech: 2-4 предложения, разговорный стиль\n- question.speech: ОДИН конкретный вопрос\n- question.hint: подсказка-НАПРАВЛЕНИЕ, не ответ\n- question.answer: краткий ответ для проверки\n- Формулы в speech СЛОВАМИ\n- НЕ начинай с приветствия\n- Обязательно числовой пример\n- JSON валидный';

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

      var sys = 'Ты Марина Сергеевна, репетитор математики. Ученик ответил на твой вопрос.\n\nОтветь в JSON:\n{"status": "correct" или "hint" или "explain", "reaction": "текст для озвучки"}\n\nПРАВИЛА ОЦЕНКИ:\n\n1. Если ответ ПРАВИЛЬНЫЙ (или близок к правильному):\n{"status": "correct", "reaction": "Короткая похвала! Точно! / Да, верно! / Ну вот видишь, сам знаешь!"}\n\n2. Если ученик говорит "не знаю", "не понимаю", "затрудняюсь", "хз", "без понятия" или попытка ' + attemptNumber + ' из 3 и ответ неверный:\n- При 1-й попытке: дай НАВОДЯЩИЙ ВОПРОС, не ответ\n{"status": "hint", "reaction": "Наводящий вопрос. Например: Вспомни, дискриминант это бэ в квадрате минус что?"}\n- При 2-й попытке: дай более конкретную подсказку\n{"status": "hint", "reaction": "Более прямая подсказка. Подставь числа: бэ это минус 7, значит бэ в квадрате это..."}\n- При 3-й попытке: объясни ответ\n{"status": "explain", "reaction": "Ладно, смотри. [Краткое объяснение с ответом]. Запомни это!"}\n\n3. Если ответ НЕВЕРНЫЙ:\n{"status": "hint", "reaction": "Не совсем. [Наводящий вопрос без ответа]"}\n\nВАЖНО:\n- reaction: 1-2 предложения максимум\n- Формулы словами\n- НЕ говори "отличная попытка", "хороший вопрос"\n- Сразу к делу\n- JSON валидный\n\nКонтекст: ' + topic;

      var evalInput = 'Вопрос учителя: ' + questionSpeech + '\nПравильный ответ: ' + correctAnswer + '\nПодсказка: ' + hintText + '\nПопытка номер: ' + attemptNumber + '\nОтвет ученика: ' + studentAnswer;

      var evalText = await callClaude(sys, evalInput, 1024);

      try {
        var cleanedEval = evalText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        var parsed = JSON.parse(cleanedEval);
        return res.status(200).json(parsed);
      } catch (e) {
        return res.status(200).json({ status: 'explain', reaction: evalText });
      }
    }

    if (type === 'answer_with_board') {
      var teacherSys = 'Ты Марина Сергеевна, репетитор. Ученик задал свой вопрос.\n\nСократический метод: наводящий вопрос, не готовый ответ.\n- НЕ повторяй вопрос\n- 2-3 предложения\n- В конце: "Ясно? Продолжим?"\n- Просто текст\n\nКонтекст: ' + topic;

      var teacherAnswer = await callClaude(teacherSys, question, 1024);

      var boardSys = 'Нужны ли формулы на доске к ответу? Если да — JSON массив, если нет — []. Макс 1-3 элемента. Только JSON.';
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
```

Commit, подожди деплой.

---

**Шаг 2 — Bolt.** Копируй:
```
В MathTutor.jsx нужно исправить два бага:
1. Система иногда не ждёт ответ ученика и сама идёт дальше
2. На "не знаю" нужно давать подсказки, а не сразу ответ

Добавь стейт для подсчёта попыток после остальных стейтов:

  const [attemptCount, setAttemptCount] = useState(0);

В функции playSegment замени блок с segment.type === 'question'. Найди строку с if (segment.type === 'question') и замени весь блок onSpeechEnd для вопроса:

    if (segment.type === 'question') {
      onSpeechEnd = () => {
        setAwaitingSegmentAnswer(true);
        setCurrentQuestion(segment);
        setAttemptCount(1);
        setChatMessages((prev) => [...prev, {
          role: 'teacher',
          content: segment.speech
        }]);
      };
    }

Замени ПОЛНОСТЬЮ функцию sendStudentQuestion на эту:

  const sendStudentQuestion = useCallback(
    async (questionText) => {
      var question = questionText?.trim() || studentMessage.trim();
      if (!question) return;

      setStudentMessage('');
      stopAudio();

      if (awaitingSegmentAnswer && currentQuestion) {
        try {
          var evalResponse = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'evaluate',
              question: question,
              topic: currentTopic,
              questionSpeech: currentQuestion.speech,
              correctAnswer: currentQuestion.answer || '',
              hint: currentQuestion.hint || '',
              attemptNumber: attemptCount,
            }),
          });

          if (!evalResponse.ok) throw new Error('Evaluate error');

          var evalData = await evalResponse.json();
          var reaction = evalData.reaction || 'Давай продолжим.';
          var status = evalData.status || 'explain';

          setChatMessages((prev) => [...prev, { role: 'teacher', content: reaction }]);

          if (status === 'correct') {
            // Правильный ответ — озвучиваем реакцию и идём дальше
            setAwaitingSegmentAnswer(false);
            setCurrentQuestion(null);
            setAttemptCount(0);

            speakWithElevenLabs(reaction).then((audio) => {
              currentAudioRef.current = audio;
              audio.onplay = () => setIsSpeaking(true);
              audio.onended = () => {
                setIsSpeaking(false);
                currentAudioRef.current = null;
                setTimeout(() => {
                  playSegment(currentSegmentIndex + 1);
                }, 500);
              };
              audio.play();
            }).catch((err) => {
              console.error(err);
              playSegment(currentSegmentIndex + 1);
            });

          } else if (status === 'hint') {
            // Подсказка — озвучиваем и ждём новый ответ
            setAttemptCount((prev) => prev + 1);

            speakWithElevenLabs(reaction).then((audio) => {
              currentAudioRef.current = audio;
              audio.onplay = () => setIsSpeaking(true);
              audio.onended = () => {
                setIsSpeaking(false);
                currentAudioRef.current = null;
                // Продолжаем ждать ответ
              };
              audio.play();
            }).catch((err) => console.error(err));

          } else {
            // explain — объяснили ответ, идём дальше
            setAwaitingSegmentAnswer(false);
            setCurrentQuestion(null);
            setAttemptCount(0);

            speakWithElevenLabs(reaction).then((audio) => {
              currentAudioRef.current = audio;
              audio.onplay = () => setIsSpeaking(true);
              audio.onended = () => {
                setIsSpeaking(false);
                currentAudioRef.current = null;
                setTimeout(() => {
                  playSegment(currentSegmentIndex + 1);
                }, 500);
              };
              audio.play();
            }).catch((err) => {
              console.error(err);
              playSegment(currentSegmentIndex + 1);
            });
          }

        } catch (error) {
          console.error('Evaluate error:', error);
          setAwaitingSegmentAnswer(false);
          setCurrentQuestion(null);
          playSegment(currentSegmentIndex + 1);
        }
        return;
      }

      // Обычный вопрос
      try {
        var context = 'Тема: ' + currentTopic;

        var response = await fetch(PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'answer_with_board',
            question: question,
            topic: context,
          }),
        });

        if (!response.ok) throw new Error('API error');

        var data = await response.json();
        var answer = data.answer || 'Не могу ответить';

        setChatMessages((prev) => [...prev, { role: 'teacher', content: answer }]);
        playVoice(answer).catch((err) => console.error(err));

        if (data.board && Array.isArray(data.board) && data.board.length > 0) {
          setBoardContent((prev) => [
            ...prev,
            { type: 'text', content: '↳ К вопросу ученика:' },
          ]);
          data.board.forEach((item, i) => {
            setTimeout(() => {
              setBoardContent((prev) => [...prev, item]);
            }, (i + 1) * 800);
          });
        }
      } catch (error) {
        console.error('Q&A error:', error);
      }
    },
    [currentTopic, studentMessage, awaitingSegmentAnswer, currentQuestion, currentSegmentIndex, segments, attemptCount]
  );

В goBack добавь:
  setAttemptCount(0);

Больше ничего не меняй.
