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
      systemPrompt = `Ты преподаватель математики. Отвечай естественно и по-человечески на вопрос студента. Контекст: ${topic}`;
    } else if (type === 'explanation') {
      systemPrompt = `Ты преподаватель математики. Объясни "${topic}" простым языком для голоса. БЕЗ формул.`;
    } else if (type === 'board') {
      systemPrompt = `Создай JSON для доски: [{"type": "text"|"formula", "content": "...", "timing": 0-120}]. LaTeX формулы. ТОЛЬКО JSON.`;
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
    
    if (type === 'board') {
      answer = answer.replace(/```json\n?/g, '').replace(/```/g, '').trim();
      const match = answer.match(/\[[\s\S]*\]/);
      answer = match ? JSON.parse(match[0]) : JSON.parse(answer);
    }
    
    return res.status(200).json({ answer });
    
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
