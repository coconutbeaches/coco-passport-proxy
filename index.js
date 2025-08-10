// Minimal CJS single-handler server for Vercel
const crypto = require('crypto');

const text = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type','text/plain; charset=utf-8'); res.end(body); };
const json = (res, status, obj) => { res.statusCode = status; res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };

const parseBody = req => new Promise((resolve,reject)=>{
  let data=''; req.on('data',c=>data+=c);
  req.on('end',()=>{ if(!data) return resolve({}); try{ resolve(JSON.parse(data)); }catch(e){ reject(e); }});
  req.on('error',reject);
});

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const baseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  'Accept-Profile': 'public',
  'Content-Profile': 'public'
};

function roomsCanonicalizeToken(tok){
  const t = tok.trim().toLowerCase();
  if (['a3','a4','a5','a6','a7','a8','a9','b6','b7','b8','b9'].includes(t)) return t.toUpperCase();
  return null;
}
function cap1(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1).toLowerCase() : s; }
function normalizeStayIdFreeform(raw){
  if(!raw) return { input:'', rooms:[], last_name_canonical:'', stay_id:'' };
  const roomsList2w = ['double house','jungle house','beach house','new house'];
  const parts = raw.split(/[\s_]+/).filter(Boolean);
  let rooms=[], lastParts=[];
  for(let i=0;i<parts.length;i++){
    const two = (parts[i]+' '+(parts[i+1]||'')).toLowerCase();
    if (roomsList2w.includes(two)){
      rooms.push(two.split(' ').map(cap1).join(' '));
      i++; continue;
    }
    const oneCanon = roomsCanonicalizeToken(parts[i]);
    if (oneCanon){ rooms.push(oneCanon); continue; }
    lastParts.push(parts[i]);
  }
  const lastNameCanonical = lastParts.map(cap1).join('').replace(/[-\s]/g,'');
  const stay_id = [...rooms, lastNameCanonical].filter(Boolean).join('_');
  return {
    input:String(raw),
    rooms_in: rooms.join(', '),
    last_in: lastParts.join(' '),
    rooms,
    last_name_canonical: lastNameCanonical,
    stay_id
  };
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, apikey, Accept-Profile, Content-Profile');
  if (req.method === 'OPTIONS') return text(res, 204, '');

  // URL parse + normalize
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch { return text(res, 400, 'Bad URL'); }
  url.pathname = url.pathname.replace(/\/+$/,'') || '/';

  // Root health
  if (req.method === 'GET' && url.pathname === '/') {
    return text(res, 200, 'OK: coco-passport-proxy');
  }

  // ---- /resolve (NEW) ----
  if (req.method === 'GET' && url.pathname === '/resolve'){
    const raw = decodeURIComponent(url.searchParams.get('stay_id') || '').trim();
    const out = normalizeStayIdFreeform(raw);
    return json(res, 200, out);
  }

  // ---- /upload-url ----
  if (req.method === 'POST' && url.pathname === '/upload-url') {
    try{
      const body = await parseBody(req);
      const stay_id = String(body.stay_id || '').trim();
      const imgUrl = String(body.url || '').trim();
      const safeName = String(body.filename || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g,'_');
      if(!stay_id || !imgUrl) return json(res, 400, { ok:false, error:'stay_id and url required' });

      const getRes = await fetch(imgUrl);
      if(!getRes.ok){
        const t = await getRes.text();
        return json(res, 400, { ok:false, error:`fetch image failed: ${getRes.status}`, body:t });
      }
      const buf = Buffer.from(await getRes.arrayBuffer());
      const objectPath = `passports/${stay_id}/${safeName}`;

      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method:'POST',
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/octet-stream', 'x-upsert':'true' },
        body: buf
      });
      if(!put.ok){
        const t = await put.text();
        return json(res, put.status, { ok:false, error:'storage upload failed', body:t });
      }
      return json(res, 200, { ok:true, object_path: objectPath });
    }catch(e){ return json(res, 500, { ok:false, error:e.message || 'upload-url error' }); }
  }

  // ---- /upload (binary) ----
  if (req.method === 'POST' && url.pathname === '/upload') {
    try{
      const stay_id = (url.searchParams.get('stay_id')||'').trim();
      const filename = (url.searchParams.get('filename')||`${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g,'_');
      if(!stay_id) return json(res, 400, { ok:false, error:'stay_id required' });

      let chunks=[]; for await (const c of req) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if(!buf.length) return json(res, 400, { ok:false, error:'no file data' });

      const objectPath = `passports/${stay_id}/${filename}`;
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method:'POST',
        headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/octet-stream', 'x-upsert':'true' },
        body: buf
      });
      if(!put.ok){ const t = await put.text(); return json(res, put.status, { ok:false, error:'storage upload failed', body:t }); }
      return json(res, 200, { ok:true, object_path: objectPath });
    }catch(e){ return json(res, 500, { ok:false, error:e.message || 'upload error' }); }
  }

  // ---- /insert ----
  if (req.method === 'POST' && url.pathname === '/insert') {
    try{
      const qVia = url.searchParams.get('via'); // 'table' to force fallback
      const body = await parseBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : null;
      if(!rows) return json(res, 400, { ok:false, error:'rows (array) required' });

      // try RPC first unless forced table
      if (qVia !== 'table') {
        const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, { method:'POST', headers: baseHeaders, body: JSON.stringify({ rows }) });
        if (rpc.ok) {
          const textBody = await rpc.text();
          return text(res, 200, textBody || '[]');
        }
        // fall through to table
      }

      const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
        method:'POST',
        headers: { ...baseHeaders, Prefer:'return=representation' },
        body: JSON.stringify(rows)
      });

      if (!tbl.ok) {
        const err = await tbl.text();
        return json(res, tbl.status, { ok:false, status:tbl.status, error:err || 'Insert failed', via:'table' });
      }

      // success — we can compute inserted vs skipped by looking at response or just mark ok
      // Some PostgREST configs return [], others return the inserted rows.
      let payload = [];
      try{ payload = await tbl.json(); }catch{ payload = []; }
      return json(res, 200, { ok:true, via:'table', inserted: Array.isArray(payload)? payload.length : undefined });
    }catch(e){ return json(res, 500, { ok:false, error:e.message || 'insert error' }); }
  }

  // ---- /export ----
  if (req.method === 'GET' && url.pathname === '/export') {
    const stay_id = (url.searchParams.get('stay_id')||'').trim();
    const rooms = (url.searchParams.get('rooms')||'').trim();
    const last = (url.searchParams.get('last')||'').trim();

    let effStay = stay_id;
    if (!effStay && (rooms || last)) {
      const resolved = normalizeStayIdFreeform(`${rooms} ${last}`);
      effStay = resolved.stay_id;
    }
    if (!effStay) return text(res, 200, 'First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday');

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests_export_view?stay_id=eq.${encodeURIComponent(effStay)}&order=created_at.asc`, { headers: baseHeaders });
    if (!resp.ok) return text(res, resp.status, await resp.text());

    let rows = [];
    try { rows = await resp.json(); } catch { rows = []; }

    const header = ['First Name','Middle Name','Last Name','Gender','Passport Number','Nationality','Birthday'].join('\t');
    const lines = rows.map(r =>
      [r['First Name']||'', r['Middle Name']||'', r['Last Name']||'', r['Gender']||'', r['Passport Number']||'', r['Nationality']||'', r['Birthday']||''].join('\t')
    );
    return text(res, 200, [header, ...lines].join('\n'));
  }

  // ---- /status ----
  if (req.method === 'GET' && url.pathname === '/status') {
    const stay_id = (url.searchParams.get('stay_id')||'').trim();
    if (!stay_id) return text(res, 200, '0 of ? passports received 📸');
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?stay_id=eq.${encodeURIComponent(stay_id)}&select=passports_received,total_guests`, { headers: baseHeaders });
    if (!resp.ok) return text(res, resp.status, await resp.text());
    const arr = await resp.json();
    const r = Array.isArray(arr) && arr[0] ? arr[0] : null;
    if (!r) return text(res, 200, '0 of ? passports received 📸');
    if (r.total_guests && r.passports_received >= r.total_guests) return text(res, 200, '✅ All received');
    return text(res, 200, `${r.passports_received || 0} of ${r.total_guests || '?'} passports received 📸`);
  }

  // ---- /recent ----
  if (req.method === 'GET' && url.pathname === '/recent') {
    const limit = Math.max(1, Math.min(20, parseInt(url.searchParams.get('limit')||'5',10)));
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests?select=stay_id,first_name,last_name,passport_number,created_at&order=created_at.desc&limit=${limit}`, { headers: baseHeaders });
    if (!resp.ok) return text(res, resp.status, await resp.text());
    return text(res, 200, await resp.text());
  }

  // 404
  return json(res, 404, { ok:false, error:'Not Found' });
};
