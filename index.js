// Minimal CommonJS serverless handler with CORS + normalized routes
const crypto = require('crypto');

const parseBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', c => data += c);
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

module.exports = async (req, res) => {
  // --- CORS ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Accept-Profile, Content-Profile');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    res.status(400).end('Bad URL');
    return;
  }

  // Normalize trailing slashes once (so /upload-url/ == /upload-url)
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';

  // Health check (no env touch)
  if (req.method === 'GET' && url.pathname === '/') {
    res.status(200).end('OK: coco-passport-proxy');
    return;
  }

  // Lazy-read env only when needed
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const needEnv = () => (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY);
  const fetchJSON = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

  const BUCKET = 'passports';

  try {
    // ===== Binary upload -> /upload
    if (req.method === 'POST' && url.pathname === '/upload') {
      if (needEnv()) return res.status(500).json({ ok:false, error:'Missing env' });
      const stay_id = url.searchParams.get('stay_id');
      const filename = url.searchParams.get('filename') || `${crypto.randomUUID()}.jpg`;
      if (!stay_id) return res.status(400).json({ ok:false, error:'stay_id required' });

      const safeName = filename.replace(/[^A-Za-z0-9._-]/g,'_');
      const objectKey = `${stay_id}/${safeName}`;               // key inside bucket
      const objectPath = `${BUCKET}/${objectKey}`;              // for storing in DB / returning

      // raw body
      const chunks=[]; for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);

      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(objectKey)}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: buf
      });
      if (!put.ok) return res.status(put.status).json({ ok:false, error:'storage upload failed', body: await fetchJSON(put) });
      res.status(200).json({ ok:true, object_path: objectPath });
      return;
    }

    // ===== URL upload -> /upload-url
    if (req.method === 'POST' && url.pathname === '/upload-url') {
      if (needEnv()) return res.status(500).json({ ok:false, error:'Missing env' });
      const { stay_id, url: imgUrl, filename } = await parseBody(req);
      if (!stay_id || !imgUrl) return res.status(400).json({ ok:false, error:'stay_id and url required' });

      const safeName = (filename || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g, '_');
      const objectKey = `${stay_id}/${safeName}`;
      const objectPath = `${BUCKET}/${objectKey}`;

      const fetchRes = await fetch(imgUrl);
      if (!fetchRes.ok) return res.status(400).json({ ok:false, error:`fetch image failed: ${fetchRes.status}`, body: await fetchRes.text() });
      const buf = Buffer.from(await fetchRes.arrayBuffer());

      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(objectKey)}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: buf
      });
      if (!put.ok) return res.status(put.status).json({ ok:false, error:'storage upload failed', body: await fetchJSON(put) });
      res.status(200).json({ ok:true, object_path: objectPath });
      return;
    }

    // ===== Insert -> /insert  (RPC first; fallback table or via=table)
    if (req.method === 'POST' && url.pathname === '/insert') {
      if (needEnv()) return res.status(500).json({ ok:false, error:'Missing env' });
      const body = await parseBody(req);
      const viaTable = url.searchParams.get('via') === 'table';

      const baseHeaders = {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      };

      const tryTable = async () => {
        const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
          method: 'POST',
          headers: { ...baseHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify(body.rows || [])
        });
        if (!tbl.ok) return res.status(tbl.status).json({ ok:false, status: tbl.status, error: await fetchJSON(tbl), via:'table' });
        return res.status(200).json({ ok:true, via:'table' });
      };

      if (viaTable) return await tryTable();

      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
        method: 'POST',
        headers: baseHeaders,
        body: JSON.stringify(body)
      });

      if (!rpc.ok) {
        // fallback
        return await tryTable();
      }
      const txt = await rpc.text();
      res.status(200).send(txt || '[]');
      return;
    }

    // ===== Export -> /export  (plain text TSV)
    if (req.method === 'GET' && url.pathname === '/export') {
      if (needEnv()) return res.status(500).end('Missing env');
      const stay_id = url.searchParams.get('stay_id');
      const rooms = url.searchParams.get('rooms');
      const last = url.searchParams.get('last');
      let qs = '';
      const selectCols = encodeURIComponent('"First Name","Middle Name","Last Name","Gender","Passport Number","Nationality","Birthday"');
      if (stay_id) {
        qs = `stay_id=eq.${encodeURIComponent(stay_id)}&order=created_at.asc&select=${selectCols}`;
      } else if (rooms && last) {
        qs = `rooms=${encodeURIComponent(rooms)}&last=${encodeURIComponent(last)}&order=created_at.asc&select=${selectCols}`;
      } else {
        return res.status(400).end('Missing stay_id or rooms+last');
      }

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests_export_view?${qs}`, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Accept-Profile': 'public'
        }
      });
      if (!resp.ok) return res.status(resp.status).end(await resp.text());

      const rows = await resp.json();
      const header = ['First Name','Middle Name','Last Name','Gender','Passport Number','Nationality','Birthday'].join('\t');
      const lines = [header, ...rows.map(r => [
        r['First Name'] ?? '',
        r['Middle Name'] ?? '',
        r['Last Name'] ?? '',
        r['Gender'] ?? '',
        r['Passport Number'] ?? '',
        r['Nationality'] ?? '',
        r['Birthday'] ?? ''
      ].join('\t'))].join('\n');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).end(lines);
      return;
    }

    // ===== Status -> /status (plain text)
    if (req.method === 'GET' && url.pathname === '/status') {
      if (needEnv()) return res.status(500).end('Missing env');
      const stay_id = url.searchParams.get('stay_id');
      if (!stay_id) return res.status(400).end('Missing stay_id');

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?stay_id=eq.${encodeURIComponent(stay_id)}`, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Accept-Profile': 'public'
        }
      });
      if (!resp.ok) return res.status(resp.status).end(await resp.text());
      const arr = await resp.json();
      const row = arr[0] || {};
      const out = row.status || (typeof row.passports_received === 'number' ? `${row.passports_received} of ${row.total_guests ?? '?'} passports received 📸` : '0 of ? passports received 📸');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).end(out);
      return;
    }

    // ===== Recent -> /recent (debug JSON)
    if (req.method === 'GET' && url.pathname === '/recent') {
      if (needEnv()) return res.status(500).json({ error:'Missing env' });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests?select=stay_id,first_name,last_name,passport_number,created_at&order=created_at.desc&limit=10`, {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Accept-Profile': 'public'
        }
      });
      const json = await fetchJSON(r);
      res.status(r.ok ? 200 : r.status).json(json);
      return;
    }

    res.status(404).end('Not found');
  } catch (e) {
    res.status(500).end(e && e.message ? e.message : 'Unknown error');
  }
};
