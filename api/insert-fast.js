module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, apikey, Accept-Profile, Content-Profile');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error:'Method Not Allowed. Use POST.' }));
  }

  // Body (no for-await)
  const raw = await new Promise((resolve) => {
    try {
      const chunks=[]; req.on('data',c=>chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c)));
      req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error',()=>resolve(''));
    } catch { resolve(''); }
  });
  let body={}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  const rows = Array.isArray(body.rows) ? body.rows : null;
  if (!rows) {
    res.statusCode=400;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error:'rows (array) required' }));
  }

  const clean = rows.map(r => ({ ...r, photo_urls: Array.isArray(r?.photo_urls) ? r.photo_urls.filter(Boolean) : [] }));

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env || {};
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.statusCode=500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error:'missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }));
  }

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Accept-Profile': 'public',
        'Content-Profile': 'public',
        Prefer: 'return=representation,resolution=merge-duplicates'
      },
      body: JSON.stringify(clean)
    });

    const txt = await r.text();
    try { console.log('/api/insert-fast status', r.status, 'body', txt.slice(0,400)); } catch {}
    if (!r.ok) {
      res.statusCode=r.status;
      res.setHeader('Content-Type','application/json; charset=utf-8');
      return res.end(JSON.stringify({ ok:false, error:'supabase insert failed', body: txt }));
    }

    let data; try { data = JSON.parse(txt); } catch { data = []; }
    const inserted = Array.isArray(data) ? data.length : 0;
    res.statusCode=200;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:true, via:'table', inserted, rows:data }));
  } catch (e) {
    try { console.error('/api/insert-fast crash', (e && e.stack) || e); } catch {}
    res.statusCode=500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({ ok:false, error: (e && e.message) || 'insert-fast error' }));
  }
};
