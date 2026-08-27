/*
 * Serverless proxy for the Anthropic API — this is the ONLY place the real
 * API key ever exists. It never reaches the browser. Deploy this as-is on
 * Vercel (api/claude.js is auto-detected as a serverless function).
 *
 * Required environment variable (set in your hosting provider's dashboard,
 * NOT in a committed file): ANTHROPIC_API_KEY
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: ANTHROPIC_API_KEY is not set' });
    return;
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      // Forward the request body as-is (model, max_tokens, messages) —
      // the frontend already builds the correct Anthropic Messages API shape.
      body: JSON.stringify(req.body),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach Anthropic API', detail: String(err) });
  }
}
