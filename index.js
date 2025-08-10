module.exports = async (req, res) => {
  try {
    if (req.method === 'GET') {
      res.status(200).send('OK: coco-passport-proxy');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: 'Missing environment variables' });
      return;
    }

    // parse JSON body (Vercel Node functions don't auto-parse)
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', c => (data += c));
      req.on('end', () => {
        try { resolve(data ? JSON.parse(data) : {}); }
        catch (e) { reject(e); }
      });
      req.on('error', reject);
    });

    const baseHeaders = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json'
    };

    // try RPC first
    const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify(body)
    });

    if (!rpc.ok) {
      // fallback to direct table insert
      const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
        method: 'POST',
        headers: { ...baseHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify(body.rows || [])
      });
      if (!tbl.ok) {
        const err = await tbl.text();
        res.status(tbl.status).send(err || 'Insert failed');
        return;
      }
      res.status(200).json({ ok: true, via: 'table' });
      return;
    }

    const text = await rpc.text();
    res.status(200).send(text || '[]');
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unknown error' });
  }
};
