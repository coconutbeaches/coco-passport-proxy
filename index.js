const parseBody = (req) => new Promise((resolve, reject) => {
  let data=''; req.on('data', c => data += c);
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e);} });
  req.on('error', reject);
});
const readRaw = (req) => new Promise((resolve, reject) => {
  const chunks=[]; req.on('data', c => chunks.push(c));
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const H = (key) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Accept-Profile': 'public',
  'Content-Profile': 'public'
});
const supaHeaders = (key, extra={}) => ({ ...H(key), ...extra });
const uuid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=(Math.random()*16)|0,v=c==='x'?r:(r&0x3|0x8);return v.toString(16);});
const buildStayId = (roomsCsv, lastRaw) => {
  const last=(lastRaw||'').trim().replace(/\s+/g,' ');
  const rooms=String(roomsCsv||'').split(',').map(s=>s.trim()).filter(Boolean)
    .sort((a,b)=>a.localeCompare(b,'en',{numeric:true})).join('_');
  return rooms && last ? `${rooms}_${last}` : null;
};
const resolveStayId = async (base, key, inputId) => {
  const id=String(inputId||'').trim(); if(!id) return null;
  let r = await fetch(`${base}/rest/v1/incoming_guests?select=stay_id&stay_id=eq.${encodeURIComponent(id)}&limit=1`, { headers:H(key) });
  let j = await r.json(); if (Array.isArray(j)&&j.length) return j[0].stay_id;
  r = await fetch(`${base}/rest/v1/incoming_guests?select=stay_id&stay_id=ilike.${encodeURIComponent(id)}&limit=1`, { headers:H(key) });
  j = await r.json(); if (Array.isArray(j)&&j.length) return j[0].stay_id;
  const loose=id.replace(/\s+/g,'_');
  r = await fetch(`${base}/rest/v1/incoming_guests?select=stay_id&stay_id=ilike.${encodeURIComponent(loose)}&limit=1`, { headers:H(key) });
  j = await r.json(); if (Array.isArray(j)&&j.length) return j[0].stay_id;
  return id;
};

module.exports = async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, apikey, Accept-Profile, Content-Profile, x-upsert');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { res.status(500).json({ error:'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }); return; }

    // Health
    if (req.method === 'GET' && path === '/') { res.status(200).setHeader('Content-Type','text/plain; charset=utf-8').end('OK: coco-passport-proxy'); return; }

    // Recent (debug)
    if (req.method === 'GET' && path === '/recent') {
      const ep = `${SUPABASE_URL}/rest/v1/incoming_guests?select=stay_id,first_name,last_name,passport_number,created_at&order=created_at.desc&limit=10`;
      const r = await fetch(ep, { headers: supaHeaders(SUPABASE_SERVICE_ROLE_KEY) });
      const j = await r.json(); res.status(r.ok?200:r.status).json(j); return;
    }

    // INSERT (RPC → table fallback)
    if (req.method === 'POST' && path === '/insert') {
      const via = url.searchParams.get('via') || 'auto';
      const body = await parseBody(req);
      const headers = supaHeaders(SUPABASE_SERVICE_ROLE_KEY, { 'Content-Type':'application/json' });

      const doTable = async () => {
        const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
          method:'POST', headers:{ ...headers, Prefer:'return=minimal' }, body: JSON.stringify(body.rows || [])
        });
        if (!tbl.ok) return { ok:false, status:tbl.status, error:await tbl.text(), via:'table' };
        return { ok:true, via:'table' };
      };

      if (via==='table') { const out=await doTable(); res.status(out.ok?200:out.status).json(out); return; }

      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, { method:'POST', headers, body: JSON.stringify(body) });
      if (!rpc.ok) { const out=await doTable(); res.status(out.ok?200:out.status).json(out); return; }
      const txt = await rpc.text(); res.status(200).setHeader('Content-Type','application/json; charset=utf-8').end(txt || '[]'); return;
    }

    // UPLOAD (binary body)
    if (req.method === 'POST' && path === '/upload') {
      const stayParam = url.searchParams.get('stay_id');
      const rooms = url.searchParams.get('rooms');
      const last  = url.searchParams.get('last');
      let stay_id = stayParam || buildStayId(rooms, last);
      if (!stay_id) { res.status(400).setHeader('Content-Type','text/plain; charset=utf-8').end('stay_id required'); return; }
      const resolved = await resolveStayId(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, stay_id);
      const name = (url.searchParams.get('filename') || `${uuid()}.jpg`).replace(/^\/+/, '');
      const bucket = 'passports';
      const objectRel = `${resolved}/${name}`;

      const buf = await readRaw(req);
      const mime = req.headers['content-type'] || 'application/octet-stream';

      const putUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectRel}`;
      const up = await fetch(putUrl, { method:'POST', headers:{ ...H(SUPABASE_SERVICE_ROLE_KEY), 'Content-Type': mime, 'x-upsert':'true' }, body: buf });
      if (!up.ok) { const t=await up.text(); res.status(up.status).setHeader('Content-Type','application/json; charset=utf-8').end(t || '{"error":"upload failed"}'); return; }
      res.status(200).json({ ok:true, object_path: `${bucket}/${objectRel}` }); return;
    }

    // UPLOAD from URL (no encoded slashes!)
    if (req.method === 'POST' && path === '/upload-url') {
      const { stay_id, url: imgUrl, filename } = await parseBody(req);
      if (!stay_id || !imgUrl) { res.status(400).json({ ok:false, error:'stay_id and url required' }); return; }
      const resolved = await resolveStayId(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, stay_id);
      const safeName = (filename || `${uuid()}.jpg`).replace(/[^A-Za-z0-9._-]/g,'_');
      const bucket = 'passports';
      const objectRel = `${resolved}/${safeName}`;

      const f = await fetch(imgUrl);
      if (!f.ok) { const t=await f.text(); res.status(400).json({ ok:false, error:`fetch image failed: ${f.status}`, body:t }); return; }
      const buf = Buffer.from(await f.arrayBuffer());

      const putUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectRel}`;
      const up = await fetch(putUrl, { method:'POST', headers:{ ...H(SUPABASE_SERVICE_ROLE_KEY), 'Content-Type':'application/octet-stream', 'x-upsert':'true' }, body: buf });
      if (!up.ok) { const t=await up.text(); res.status(up.status).json({ ok:false, error:'storage upload failed', body:t }); return; }

      res.status(200).json({ ok:true, object_path: `${bucket}/${objectRel}` }); return;
    }

    // EXPORT — tab-delimited with header
    if (req.method === 'GET' && path === '/export') {
      const rooms = url.searchParams.get('rooms');
      const last  = url.searchParams.get('last');
      let stay_id = url.searchParams.get('stay_id') || buildStayId(rooms, last);
      if (!stay_id) { res.status(400).setHeader('Content-Type','text/plain; charset=utf-8').end('stay_id required'); return; }
      const resolved = await resolveStayId(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, stay_id);

      const sel = '%22First%20Name%22,%22Middle%20Name%22,%22Last%20Name%22,%22Gender%22,%22Passport%20Number%22,%22Nationality%22,%22Birthday%22';
      const ep = `${SUPABASE_URL}/rest/v1/incoming_guests_export_view?stay_id=eq.${encodeURIComponent(resolved)}&order=created_at.asc&select=${sel}`;
      const r = await fetch(ep, { headers: supaHeaders(SUPABASE_SERVICE_ROLE_KEY) });
      const rows = await r.json();

      const header = ['First Name','Middle Name','Last Name','Gender','Passport Number','Nationality','Birthday'].join('\t');
      const body = (Array.isArray(rows)?rows:[]).map(o=>[
        o['First Name']??'', o['Middle Name']??'', o['Last Name']??'',
        o['Gender']??'', o['Passport Number']??'', o['Nationality']??'', o['Birthday']??''
      ].join('\t')).join('\n');

      res.status(r.ok?200:r.status).setHeader('Content-Type','text/plain; charset=utf-8').end([header, body].filter(Boolean).join('\n')); return;
    }

    // STATUS — single line
    if (req.method === 'GET' && path === '/status') {
      let stay_id = url.searchParams.get('stay_id');
      if (!stay_id) { res.status(400).setHeader('Content-Type','text/plain; charset=utf-8').end('stay_id required'); return; }
      const resolved = await resolveStayId(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, stay_id);

      const ep = `${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?stay_id=eq.${encodeURIComponent(resolved)}`;
      const r = await fetch(ep, { headers: supaHeaders(SUPABASE_SERVICE_ROLE_KEY) });
      const j = await r.json();

      let out = '0 of ? passports received 📸';
      if (Array.isArray(j) && j.length) {
        const { passports_received:x, total_guests:y, status } = j[0];
        out = y && x >= y ? '✅ All received' : `${x ?? 0} of ${y ?? '?'} passports received 📸`;
        if (status) out = status;
      }
      res.status(200).setHeader('Content-Type','text/plain; charset=utf-8').end(out); return;
    }

    res.status(404).setHeader('Content-Type','text/plain; charset=utf-8').end('Not found');
  } catch (e) {
    res.status(500).json({ error: e.message || 'Unknown error' });
  }
};
