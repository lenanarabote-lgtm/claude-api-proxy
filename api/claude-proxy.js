if (type === 'answer') {
  systemPrompt = `Ты преподаватель математики во время урока. 

${topic}

Студент задал вопрос. Ответь двумя частями:

1. ГОЛОС: Естественный разговорный ответ БЕЗ формул
2. ДОСКА: JSON массив с ключевыми формулами/пояснениями

Формат ответа:
ГОЛОС: [твой текстовый ответ]
ДОСКА: [{"type": "text"|"formula", "content": "...", "timing": 0}]

Если вопрос не требует формул на доске - верни пустой массив для ДОСКА.`;
}

// И после получения ответа от Claude, парсим обе части:

if (type === 'answer') {
  const voiceMatch = answer.match(/ГОЛОС:\s*(.+?)(?=ДОСКА:|$)/s);
  const boardMatch = answer.match(/ДОСКА:\s*(\[[\s\S]*\])/);
  
  const voice = voiceMatch ? voiceMatch[1].trim() : answer;
  let board = [];
  
  if (boardMatch) {
    try {
      board = JSON.parse(boardMatch[1]);
    } catch (e) {
      console.error('Board parse error:', e);
    }
  }
  
  return res.status(200).json({ 
    answer: voice,
    boardItems: board
  });
}
