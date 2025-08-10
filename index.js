const crypto = require('crypto');

const parseBody = (req) => new Promise((resolve, reject) => {
  let data = '';
  req.on('data', c => data += c);
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});

function pad(n){return n<10?'0'+n:''+n}
function fmtDate(d, fmt){
  return fmt.replace('%m', pad(d.getMonth()+1)).replace('%d', pad(d.getDate())).replace('%Y', d.getFullYear());
}
function resolveTemplateDates(urlStr){
  try{
    const now = new Date();
    const tmr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1));
    return urlStr
      .replace(/{start:%([^}]+)}/g, (_,fmt)=>fmtDate(tmr, '%'+fmt))
      .replace(/{end:%([^}]+)}/g,   (_,fmt)=>fmtDate(tmr, '%'+fmt));
  }catch(e){ return urlStr }
}

async function fetchJson(u, opts={}) {
  const r = await fetch(u, opts);
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, json: JSON.parse(text), text }; }
  catch { return { ok: r.ok, status: r.status, json: null, text }; }
}

const ROOM_ORDER = [
  "A3","A4","A5","A6","A7","A8","A9",
  "B6","B7","B8","B9",
  "Double House","Jungle House","Beach House","New House"
];

function cap1(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; }

function normalizeStayIdFreeform(raw) {
  if (!raw) return { input:'', rooms_in:'', last_in:'', rooms:[], last_name_canonical:'', stay_id:'' };
  let s = String(raw).trim();
  s = s.replace(/[,+]/g,' ').replace(/\s+/g,' ').trim();

  const parts = s.split(/\s+/);
  const used = new Array(parts.length).fill(false);
  let rooms = [];

  // 1) two-word rooms
  for (let i=0;i<parts.length-1;i++){
    if (used[i]||used[i+1]) continue;
    const two = (parts[i]+' '+parts[i+1]).toLowerCase();
    const hit = ROOM_ORDER.find(r=>r.toLowerCase()===two);
    if (hit){ rooms.push(hit); used[i]=used[i+1]=true; i++; }
  }
  // 2) single-word A*/B* codes
  for (let i=0;i<parts.length;i++){
    if (used[i]) continue;
    const t = parts[i].toLowerCase();
    if (/^[ab][0-9]+$/.test(t)) {
      const canon = t.toUpperCase();
      if (ROOM_ORDER.includes(canon)) { rooms.push(canon); used[i]=true; }
    }
  }
  // 3) last name = remaining tokens
  const lastParts = parts.filter((_,i)=>!used[i]);
  let lastNameCanonical = lastParts.map(cap1).join('').replace(/[\s-]+/g,'');

  // 4) dedupe + sort rooms by ROOM_ORDER
  rooms = Array.from(new Set(rooms));
  rooms.sort((a,b)=>ROOM_ORDER.indexOf(a)-ROOM_ORDER.indexOf(b));

  const stay_id = [...rooms, lastNameCanonical].filter(Boolean).join('_');
  return {
    input: String(raw),
    rooms_in: rooms.join(', '),
    last_in: lastParts.join(' '),
    rooms,
    last_name_canonical: lastNameCanonical,
    stay_id
  };
}

module.exports = async (req, res) => {
  // Basic CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Accept-Profile, Content-Profile');
  if (req.method === 'OPTIONS') { res.statusCode = 200; res.end(); return; }

  let url;
  try {
    url = new URL(req.url, 'http://x');
  } catch {
    res.status(400).json({ ok:false, error:'bad url' }); return;
  }
  url.pathname = url.pathname.replace(/\/+$/,'') || '/';

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env || {};
  const baseHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Accept-Profile': 'public',
    'Content-Profile': 'public'
  };

  // --- Health ---------------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/') {
    res.status(200).send('OK: coco-passport-proxy'); return;
  }

  // --- Resolve stay label to canonical stay_id ------------------------------
  if (req.method === 'GET' && url.pathname === '/resolve') {
    const raw = url.searchParams.get('stay_id') || '';
    const out = normalizeStayIdFreeform(raw);
    res.status(200).json(out); return;
  }

  // --- Upload (binary) ------------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/upload') {
    try {
      const stay_id = url.searchParams.get('stay_id');
      const filename = url.searchParams.get('filename') || (crypto.randomUUID()+'.jpg');
      if (!stay_id) { res.status(400).json({ ok:false, error:'stay_id required' }); return; }

      const objectPath = `passports/${stay_id}/${filename}`;
      const chunks = [];
      req.on('data', c=>chunks.push(c));
      req.on('end', async ()=>{
        const buf = Buffer.concat(chunks);
        const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`,{
          method:'POST',
          headers:{
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/octet-stream',
            'x-upsert':'true'
          },
          body: buf
        });
        const t = await put.text();
        if (!put.ok){ res.status(put.status).json({ ok:false, error:'storage upload failed', body:t }); return; }
        res.status(200).json({ ok:true, object_path: objectPath });
      });
    } catch(e){
      res.status(500).json({ ok:false, error: e.message || 'upload error' });
    }
    return;
  }

  // --- Upload from URL ------------------------------------------------------
  if (req.method === 'POST' && url.pathname === '/upload-url') {
    try {
      const { stay_id, url: imgUrl, filename } = await parseBody(req).catch(()=>({}));
      if (!stay_id || !imgUrl) { res.status(400).json({ ok:false, error:'stay_id and url required' }); return; }
      const safe = (filename || crypto.randomUUID()+'.jpg').replace(/[^A-Za-z0-9._-]/g,'_');
      const objectPath = `passports/${stay_id}/${safe}`;

      const get = await fetch(imgUrl);
      if (!get.ok){ const t=await get.text(); res.status(400).json({ ok:false, error:`fetch image failed: ${get.status}`, body:t }); return; }
      const buf = Buffer.from(await get.arrayBuffer());

      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`,{
        method:'POST',
        headers:{
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert':'true'
        },
        body: buf
      });
      const t = await put.text();
      if (!put.ok){ res.status(put.status).json({ ok:false, error:'storage upload failed', body:t }); return; }
      res.status(200).json({ ok:true, object_path: objectPath });
      return;
    } catch(e){
      res.status(500).json({ ok:false, error: e.message || 'upload-url error' }); return;
    }
  }

  // --- Insert (RPC first, fallback to table) --------------------------------
  if (req.method === 'POST' && url.pathname === '/insert') {
    try {
      const body = await parseBody(req).catch(()=>({}));
      const viaTable = url.searchParams.get('via') === 'table';
      if (!body || !Array.isArray(body.rows)) { res.status(400).json({ ok:false, error:'rows (array) required' }); return; }

      if (!viaTable) {
        // Try RPC
        const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
          method:'POST', headers: baseHeaders, body: JSON.stringify(body)
        });
        if (rpc.ok) { const txt = await rpc.text(); res.status(200).send(txt || '[]'); return; }
      }
      // Fallback: direct table
      const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
        method:'POST',
        headers:{ ...baseHeaders, Prefer:'return=representation' },
        body: JSON.stringify(body.rows)
      });
      const txt = await tbl.text();
      if (!tbl.ok){
        let inserted=0, skipped=[], status=tbl.status;
        try {
          const rows = Array.isArray(body.rows) ? body.rows : [];
          for (const r of rows){
            const one = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
              method:'POST',
              headers:{ ...baseHeaders, Prefer:'return=representation' },
              body: JSON.stringify([r])
            });
            const ot = await one.text();
            if (one.ok) inserted++; else skipped.push({ passport_number:r.passport_number, reason:'duplicate', raw:ot });
          }
          res.status(200).json({ ok:true, via:'table', inserted, skipped });
          return;
        } catch {
          res.status(status||500).json({ ok:false, status, error:txt }); return;
        }
      }
      // On success, return array or ack
      try { const j = JSON.parse(txt); res.status(200).json(j); }
      catch { res.status(200).send(txt || '[]'); }
      return;
    } catch(e){
      res.status(500).json({ ok:false, error: e.message || 'insert error' }); return;
    }
  }

  // --- Export (tab-delimited 7 columns + header) ----------------------------
  if (req.method === 'GET' && url.pathname === '/export') {
    const stay_id = url.searchParams.get('stay_id');
    let where = '';
    if (stay_id) where = `stay_id=eq.${encodeURIComponent(stay_id)}`;
    const u = `${SUPABASE_URL}/rest/v1/incoming_guests_export_view?${where}&order=created_at.asc&select=%22First%20Name%22,%22Middle%20Name%22,%22Last%20Name%22,%22Gender%22,%22Passport%20Number%22,%22Nationality%22,%22Birthday%22`;
    const r = await fetch(u, { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept-Profile':'public' }});
    const j = await r.json().catch(()=>[]);
    const header = ['First Name','Middle Name','Last Name','Gender','Passport Number','Nationality','Birthday'].join('\t');
    const lines = j.map(row => [row['First Name'],row['Middle Name'],row['Last Name'],row['Gender'],row['Passport Number'],row['Nationality'],row['Birthday']].join('\t'));
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.status(200).send([header, ...lines].join('\n')); return;
  }

  // --- Status (uses view v_passport_status_by_stay) --------------------------
  if (req.method === 'GET' && url.pathname === '/status') {
    const stay_id = url.searchParams.get('stay_id');
    const u = `${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?stay_id=eq.${encodeURIComponent(stay_id)}`;
    const r = await fetch(u, { headers:{ apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Accept-Profile':'public' }});
    const j = await r.json().catch(()=>[]);
    const status = Array.isArray(j) && j[0] && j[0].status ? j[0].status : '0 of ? passports received 📸';
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.status(200).send(status); return;
  }

  // --- Tokeet feed upsert (server pulls feed) --------------------------------
  if (req.method === 'POST' && url.pathname === '/tokeet-upsert') {
    try {
      const body = await parseBody(req).catch(()=>({}));
      const feedUrl = body.feed_url || process.env.TOKEET_FEED_URL;
      if (!feedUrl) { res.status(400).json({ ok:false, error:'missing feed_url (body) or TOKEET_FEED_URL env' }); return; }

      const feed = await fetchJson(resolveTemplateDates(feedUrl));
      if (!feed.ok) { res.status(feed.status||500).json({ ok:false, error:'fetch feed failed', body: feed.text }); return; }

      const items = Array.isArray(feed.json) ? feed.json : (feed.json?.items || []);
      const rows = [];
      for (const it of items) {
        const label = `${(it.rooms||'').toString()} ${(it.last||it.guest_last||'').toString()}`.trim();
        const r = normalizeStayIdFreeform(label);
        if (!r.stay_id) continue;
        rows.push({
          stay_id: r.stay_id,
          rooms: r.rooms || [],
          check_in: it.check_in || null,
          check_out: it.check_out || null,
          expected_guest_count: it.expected_guest_count ?? it.guests ?? null
        });
      }
      if (!rows.length) { res.status(200).json({ ok:true, upserted:0 }); return; }

      const put = await fetch(`${SUPABASE_URL}/rest/v1/stays_preseed`, {
        method:'POST',
        headers:{ ...baseHeaders, Prefer:'resolution=merge-duplicates' },
        body: JSON.stringify(rows)
      });
      const txt = await put.text();
      if (!put.ok) { res.status(put.status).json({ ok:false, error:'upsert failed', body:txt }); return; }
      res.status(200).json({ ok:true, upserted: rows.length }); return;
    } catch(e){
      res.status(500).json({ ok:false, error: e.message || 'tokeet-upsert error' }); return;
    }
  }

  // --- Tokeet direct rows upsert (this is the one you’re calling) ------------
  if (req.method === 'POST' && url.pathname === '/tokeet-upsert-rows') {
    try {
      const body = await parseBody(req).catch(()=>({}));
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) { res.status(400).json({ ok:false, error:'rows array required' }); return; }
      const put = await fetch(`${SUPABASE_URL}/rest/v1/stays_preseed`, {
        method:'POST',
        headers:{ ...baseHeaders, Prefer:'resolution=merge-duplicates' },
        body: JSON.stringify(rows)
      });
      const txt = await put.text();
      if (!put.ok) { res.status(put.status).json({ ok:false, error:'upsert failed', body:txt }); return; }
      res.status(200).json({ ok:true, upserted: rows.length }); return;
    } catch(e){
      res.status(500).json({ ok:false, error: e.message || 'tokeet-upsert-rows error' }); return;
    }
  }

  // --- Fallbacks -------------------------------------------------------------
  if (req.method === 'GET' && url.pathname === '/tokeet-upsert') {
    res.status(405).json({ ok:false, error:'Method Not Allowed. Use POST.' }); return;
  }

  // Not found
  res.status(404).json({ ok:false, error:'Not Found' });
};
