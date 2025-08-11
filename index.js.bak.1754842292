const crypto = require('crypto');

function json(res, code, obj) {
  res.status(code).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function text(res, code, body) {
  res.status(code).setHeader('Content-Type','text/plain; charset=utf-8');
  res.end(body);
}

const baseHeaders = () => ({
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  'Accept-Profile': 'public',
  'Content-Profile': 'public',
});

const parseBody = (req) => new Promise((resolve, reject) => {
  let data=''; req.on('data', c => data += c);
  req.on('end', () => { if(!data) return resolve({}); try{ resolve(JSON.parse(data)); }catch(e){ reject(e); }});
  req.on('error', reject);
});

function pad(n){return n<10?'0'+n:''+n}
function fmtDate(d, fmt){return fmt.replace('%m',pad(d.getMonth()+1)).replace('%d',pad(d.getDate())).replace('%Y',d.getFullYear())}
function resolveTemplateDates(urlStr){
  try {
    const now = new Date();
    const tmr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1));
    return urlStr
      .replace(/{start:%([^}]+)}/g, (_,fmt)=>fmtDate(tmr,'%'+fmt))
      .replace(/{end:%([^}]+)}/g,   (_,fmt)=>fmtDate(tmr,'%'+fmt));
  } catch { return urlStr }
}

async function fetchJson(u, opts={}) {
  const r = await fetch(u, opts);
  const t = await r.text();
  try { return { ok:r.ok, status:r.status, json: JSON.parse(t), text:t }; }
  catch { return { ok:r.ok, status:r.status, json: null, text:t }; }
}

/* ===== Resolver (rooms + last) ===== */
const ROOM_ORDER = ["A3","A4","A5","A6","A7","A8","A9","B6","B7","B8","B9","Double House","Jungle House","Beach House","New House"];
function cap1(s){return s ? s.charAt(0).toUpperCase()+s.slice(1).toLowerCase() : s;}
function normalizeStayIdFreeform(rawInput) {
  const raw = String(rawInput||'').trim();
  if (!raw) return { input:'', rooms_in:'', last_in:'', rooms:[], last_name_canonical:'', stay_id:'' };

  let s = raw.replace(/[,\.;:]+/g,' ');
  s = s.replace(/_/g,' ');
  const parts = s.split(/\s+/).filter(Boolean);
  const used = Array(parts.length).fill(false);

  const rooms = [];
  for (let i=0;i<parts.length;i++) {
    if (used[i]) continue;
    const w = parts[i].toLowerCase();
    if (i+1 < parts.length) {
      const two = (parts[i] + ' ' + parts[i+1]).toLowerCase();
      const hit = ROOM_ORDER.find(r => r.toLowerCase() === two);
      if (hit) { rooms.push(hit); used[i]=used[i+1]=true; i++; continue; }
    }
    const oneHit = ROOM_ORDER.find(r => r.toLowerCase() === w);
    if (oneHit) { rooms.push(oneHit); used[i]=true; continue; }
  }
  for (let i=0;i<parts.length;i++){
    if (used[i]) continue;
    const t = parts[i].toUpperCase();
    if (/^[AB]\d+$/.test(t) && ROOM_ORDER.includes(t)) { rooms.push(t); used[i]=true; }
  }
  const lastParts = parts.filter((_,i)=>!used[i]);
  let lastNameCanonical = lastParts.map(cap1).join('').replace(/[\s-]+/g,'');
  const seen = new Set(); const dedupRooms = [];
  for (const r of rooms) if (!seen.has(r)) { seen.add(r); dedupRooms.push(r); }
  dedupRooms.sort((a,b)=>ROOM_ORDER.indexOf(a)-ROOM_ORDER.indexOf(b));

  const stay_id = [...dedupRooms, lastNameCanonical].filter(Boolean).join('_');
  return {
    input: raw,
    rooms_in: dedupRooms.join(', '),
    last_in: lastParts.join(' '),
    rooms: dedupRooms,
    last_name_canonical: lastNameCanonical,
    stay_id
  };
}

/* ===== Main handler ===== */
module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, apikey, Accept-Profile, Content-Profile');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  let url;
  try {
    url = new URL(req.url, 'http://x');
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  } catch (e) {
    json(res, 400, { ok:false, error:'Bad URL' });
    return;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    json(res, 500, { ok:false, error:'Missing SUPABASE envs' });
    return;
  }

  try {
    /* ---- Health ---- */
    if (req.method === 'GET' && url.pathname === '/') {
      return text(res, 200, 'OK: coco-passport-proxy');
    }

    /* ---- Resolve ---- */
    if (req.method === 'GET' && url.pathname === '/resolve') {
      const raw = url.searchParams.get('stay_id') || '';
      return json(res, 200, normalizeStayIdFreeform(raw));
    }

    /* ---- Upload (binary) ---- */
    if (req.method === 'POST' && url.pathname === '/upload') {
      const stay_id = url.searchParams.get('stay_id') || '';
      const filename = url.searchParams.get('filename') || `${crypto.randomUUID()}.jpg`;
      if (!stay_id) return json(res, 400, { ok:false, error:'stay_id required' });

      const chunks=[]; for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (!buf.length) return json(res, 400, { ok:false, error:'no body' });

      const objectPath = `passports/${stay_id}/${filename.replace(/[^A-Za-z0-9._-]/g,'_')}`;
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: buf
      });
      const t = await put.text();
      if (!put.ok) return json(res, put.status, { ok:false, error:'storage upload failed', body:t });
      return json(res, 200, { ok:true, object_path: objectPath });
    }

    /* ---- Upload from URL ---- */
    if (req.method === 'POST' && url.pathname === '/upload-url') {
      const b = await parseBody(req).catch(()=>({}));
      const stay_id = b.stay_id || '';
      const imgUrl = b.url || '';
      const filename = (b.filename || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g,'_');
      if (!stay_id || !imgUrl) return json(res, 400, { ok:false, error:'stay_id and url required' });

      const r = await fetch(imgUrl);
      if (!r.ok) return json(res, 400, { ok:false, error:`fetch image failed: ${r.status}`, body: await r.text() });
      const buf = Buffer.from(await r.arrayBuffer());

      const objectPath = `passports/${stay_id}/${filename}`;
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: buf
      });
      const t = await put.text();
      if (!put.ok) return json(res, put.status, { ok:false, error:'storage upload failed', body:t });
      return json(res, 200, { ok:true, object_path: objectPath });
    }

    /* ---- Insert (table path; [] also treated as success upstream) ---- */
    if (req.method === 'POST' && url.pathname === '/insert') {
      const b = await parseBody(req).catch(()=>({}));
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) return json(res, 400, { ok:false, error:'rows (array) required' });

      const r = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
        method: 'POST',
        headers: { ...baseHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(rows)
      });
      const t = await r.text();
      if (!r.ok) return json(res, r.status, { ok:false, error:t, via:'table' });
      // Some clients expect [] — return that on success for compatibility
      try { const j = JSON.parse(t); return json(res, 200, j); } catch { return json(res, 200, []); }
    }

    /* ---- Export (tab-delimited 7 cols) ---- */
    if (req.method === 'GET' && url.pathname === '/export') {
      const stay_id = url.searchParams.get('stay_id') || '';
      const rooms = url.searchParams.get('rooms') || '';
      const last = url.searchParams.get('last') || '';
      let sid = stay_id;
      if (!sid && (rooms || last)) {
        const r = normalizeStayIdFreeform(`${rooms} ${last}`);
        sid = r.stay_id;
      }
      if (!sid) return text(res, 200, 'First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday');

      const q = new URL(`${SUPABASE_URL}/rest/v1/incoming_guests_export_view`);
      q.searchParams.set('select','*');
      q.searchParams.set('stay_id', `eq.${sid}`);

      const r = await fetch(q.toString(), { headers: baseHeaders() });
      const t = await r.text();
      if (!r.ok) return text(res, r.status, t || 'export error');

      let rows = [];
      try { rows = JSON.parse(t); } catch { rows = []; }
      const header = 'First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday';
      const body = rows.map(x =>
        [x.first_name||'', x.middle_name||'', x.last_name||'', x.gender||'', x.passport_number||'', x.nationality_alpha3||'', x.birthday_ddmmyyyy||''].join('\t')
      ).join('\n');
      return text(res, 200, body ? `${header}\n${body}` : header);
    }

    /* ---- Status ---- */
    if (req.method === 'GET' && url.pathname === '/status') {
      const label = url.searchParams.get('stay_id') || '';
      const resolved = normalizeStayIdFreeform(label);
      if (!resolved.stay_id) return text(res, 200, '0 of ? passports received 📸');

      const q = new URL(`${SUPABASE_URL}/rest/v1/v_passport_status_by_stay`);
      q.searchParams.set('select','status');
      q.searchParams.set('stay_id', `eq.${resolved.stay_id}`);
      const r = await fetch(q.toString(), { headers: baseHeaders() });
      const t = await r.text();
      if (!r.ok) return text(res, r.status, t || 'status error');

      let rows = [];
      try { rows = JSON.parse(t); } catch { rows = []; }
      const line = rows[0]?.status || '0 of ? passports received 📸';
      return text(res, 200, line);
    }

    /* ---- Tokeet upsert ---- */
    if (url.pathname === '/tokeet-upsert') {
      if (req.method !== 'POST') return json(res, 405, { ok:false, error:'Method Not Allowed. Use POST.' });

      const body = await parseBody(req).catch(()=>({}));
      const feedUrl = body.feed_url || process.env.TOKEET_FEED_URL || '';
      if (!feedUrl) return json(res, 400, { ok:false, error:'missing feed_url (body) or TOKEET_FEED_URL env' });

      const feed = await fetchJson(resolveTemplateDates(feedUrl));
      if (!feed.ok) return json(res, feed.status||500, { ok:false, error:'fetch feed failed', body: feed.text });

      const items = Array.isArray(feed.json) ? feed.json : (feed.json && feed.json.items ? feed.json.items : []);
      const rows = [];
      for (const it of items) {
        const label = `${(it.rooms||'').toString()} ${(it.last||it.guest_last||'').toString()}`.trim();
        const r = normalizeStayIdFreeform(label);
        if (!r.stay_id) continue;
        rows.push({
          stay_id: r.stay_id,
          rooms: r.rooms,
          check_in: it.check_in || null,
          check_out: it.check_out || null,
          expected_guest_count: it.expected_guest_count ?? it.guests ?? null
        });
      }
      if (!rows.length) return json(res, 200, { ok:true, upserted:0 });

      const put = await fetch(`${SUPABASE_URL}/rest/v1/stays_preseed`, {
        method: 'POST',
        headers: { ...baseHeaders(), Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(rows)
      });
      const txt = await put.text();
      if (!put.ok) return json(res, put.status, { ok:false, error:'upsert failed', body:txt });

      return json(res, 200, { ok:true, upserted: rows.length });
    }

    // Fallback 404
    return json(res, 404, { ok:false, error:'Not Found' });
  } catch (e) {
    return text(res, 500, 'Server error: ' + (e && e.message ? e.message : 'unknown'));
  }

  // --- Tokeet upsert (direct rows): client posts parsed bookings ----------------
  if (req.method === 'POST' && url.pathname === '/tokeet-upsert-rows') {
    try {
      const body = await parseBody(req).catch(()=>({}));
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) { res.status(400).json({ok:false,error:'rows array required'}); return; }

      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
      const put = await fetch(`${SUPABASE_URL}/rest/v1/stays_preseed`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
          'Accept-Profile': 'public',
          'Content-Profile': 'public'
        },
        body: JSON.stringify(rows)
      });
      const txt = await put.text();
      if (!put.ok) { res.status(put.status).json({ok:false,error:'upsert failed',body:txt}); return; }
      res.status(200).json({ok:true, upserted: rows.length});
      return;
    } catch(e) {
      res.status(500).json({ok:false,error:e.message||'tokeet-upsert-rows error'}); return;
    }
  }
};
