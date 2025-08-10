const parseBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', c => (data += c));
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

const supaHeaders = (key) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'Accept-Profile': 'public',
  'Content-Profile': 'public'
});

module.exports = async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Accept-Profile, Content-Profile');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }); return;
    }

    // Health
    if (req.method === 'GET' && path === '/') {
      res.status(200).send('OK: coco-passport-proxy'); return;
    }

    // Recent rows (debug)
    if (req.method === 'GET' && path === '/recent') {
      const endpoint = `${SUPABASE_URL}/rest/v1/incoming_guests?select=stay_id,first_name,last_name,passport_number,created_at&order=created_at.desc&limit=10`;
      const r = await fetch(endpoint, { headers: supaHeaders(SUPABASE_SERVICE_ROLE_KEY) });
      const j = await r.json();
      res.status(r.ok ? 200 : r.status).json(j); return;
    }

    // Export (tab)
    if (req.method === 'GET' && path === '/export') {
      const stay_id = url.searchParams.get('stay_id');
      if (!stay_id) { res.status(400).json({ error: 'stay_id required' }); return; }
      const sel = '%22First%20Name%22,%22Middle%20Name%22,%22Last%20Name%22,%22Gender%22,%22Passport%20Number%22,%22Nationality%22,%22Birthday%22';
      const endpoint = `${SUPABASE_URL}/rest/v1/incoming_guests_export_view?stay_id=eq.${encodeURIComponent(stay_id)}&order=created_at.asc&select=${sel}`;
      const r = await fetch(endpoint, { headers: supaHeaders(SUPABASE_SERVICE_ROLE_KEY) });
      const rows = await r.json();
      if (!r.ok) { res.status(r.status).json(rows); return; }
      const header = ['First Name','Middle Name','Last Name','Gender','Passport Number','Nationality','Birthday'].join('\t');
      const body = rows.map(o => [
        o['First Name'] ?? '', o['Middle Name'] ?? '', o['Last Name'] ?? '',
        o['Gender'] ?? '', o['Passport Number'] ?? '', o['Nationality'] ?? '', o['Birthday'] ?? ''
      ].join('\t')).join('\n');
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.status(200).send([header, body].filter(Boolean).join('\n')); return;
    }

    // Status
    if (req.method === 'GET' && path === '/status') {
      const stay_id = url.searchParams.get('stay_id');
      if (!stay_id) { res.status(400).json({ error: 'stay_id required' }); return; }
      const endpoint = `${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?stay_id=eq.${encodeURIComponent(stay_id)}`;
      const r = await fetch(endpoint, { headers: supaHeaders(SUPABASE_SERVICE_ROLE_KEY) });
      const j = await r.json();
      if (!r.ok) { res.status(r.status).json(j); return; }
      let out = '0 of ? passports received 📸';
      if (Array.isArray(j) && j.length) {
        const { passports_received: x, total_guests: y, status } = j[0];
        out = y && x >= y ? '✅ All received' : `${x ?? 0} of ${y ?? '?'} passports received 📸`;
        if (status) out = status;
      }
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.status(200).send(out); return;
    }

    // Insert (supports ?via=table to force table insert)
    if (req.method === 'POST' && path === '/insert') {
      const via = url.searchParams.get('via') || 'auto';
      const body = await parseBody(req);
      const headers = supaHeaders(SUPABASE_SERVICE_ROLE_KEY);

      const doTable = async () => {
        const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
          method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(body.rows || [])
        });
        if (!tbl.ok) return { ok:false, status: tbl.status, error: await tbl.text(), via:'table' };
        return { ok:true, via:'table' };
      };

      if (via === 'table') {
        const out = await doTable(); res.status(out.ok ? 200 : out.status).json(out); return;
      }

      // try RPC first
      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
        method: 'POST', headers, body: JSON.stringify(body)
      });

      if (!rpc.ok) {
        const out = await doTable(); res.status(out.ok ? 200 : out.status).json(out); return;
      }

      // RPC typically returns [] (empty array) on success
      let txt = await rpc.text();
      let parsed; try { parsed = JSON.parse(txt || '[]'); } catch { parsed = []; }
      res.status(200).json({ ok:true, via:'rpc', result: parsed }); return;
    }

    res.status(404).json({ error: 'Not found' });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unknown error' });
  }
};
