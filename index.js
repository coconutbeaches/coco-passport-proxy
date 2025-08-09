import fetch from 'node-fetch';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Missing environment variables' });
  }

  try {
    const supabaseRes = await fetch(\`\${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests_public\`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': \`Bearer \${SUPABASE_SERVICE_ROLE_KEY}\`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const data = await supabaseRes.json();
    res.status(supabaseRes.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
