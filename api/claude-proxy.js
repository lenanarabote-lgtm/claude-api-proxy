export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { type, question, topic } = req.body;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }
  
  try {
    let systemPrompt = '';
    
    if (type === 'answer') {
      systemPrompt = `Ты преподаватель математики. Контекст урока: ${topic}. 
      
Студент задал вопрос. Ответь в формате:

ГОЛОС: [естественный разговорный ответ БЕЗ формул]
ДОСКА: [{"type": "text"|"formula", "content": "...", "timing": 0}]

Пример:
ГОЛОС: Дискриминант показывает сколько корней имеет уравнение
ДОСКА: [{"type": "formula", "content": "D = b^2 - 4ac", "timing": 0}]`;
      
    } else if (type === 'explanation') {
      systemPrompt = `Объясни "${topic}" для голоса. БЕЗ формул.`;
    } else if (type === 'board') {
      systemPrompt = `JSON для доски: [{"type": "text"|"formula", "content": "...", "timing": 0-120}]. ТОЛЬКО JSON.`;
    }
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }]
      })
    });
    
    const data = await response.json();
    let answer = data.content[0].text;
    
    // Парсим ответ в зависимости от типа
    if (type === 'answer') {
      const voiceMatch = answer.match(/ГОЛОС:\s*(.+?)(?=ДОСКА:|$)/s);
      const boardMatch = answer.match(/ДОСКА:\s*(\[[\s\S]*?\])/);
      
      const voice = voiceMatch ? voiceMatch[1].trim() : answer;
      let board = [];
      
      if (boardMatch) {
        try {
          const boardText = boardMatch[1].replace(/```json|```/g, '').trim();
          board = JSON.parse(boardText);
        } catch (e) {
          console.error('Board parse error:', e);
        }
      }
      
      return res.status(200).json({ 
        answer: voice,
        boardItems: board
      });
    }
    
    if (type === 'board') {
      answer = answer.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = answer.match(/\[[\s\S]*\]/);
      answer = match ? JSON.parse(match[0]) : JSON.parse(answer);
    }
    
    return res.status(200).json({ answer });
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
