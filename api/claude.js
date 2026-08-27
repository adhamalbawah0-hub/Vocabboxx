export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: GROQ_API_KEY is not set' });
    return;
  }

  try {
    const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: req.body.messages,
        max_tokens: req.body.max_tokens || 1000,
      }),
    });

    const data = await upstream.json();

    if (data.choices && data.choices[0]) {
      res.status(200).json({
        content: [{ text: data.choices[0].message.content }]
      });
    } else {
      res.status(upstream.status).json(data);
    }
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach Groq API', detail: String(err) });
  }
}
