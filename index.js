const crypto = require('crypto');

// Base URL configuration with runtime safety check
const PUBLIC_PASSPORT_PROXY_URL = 'https://coco-passport-proxy.vercel.app';

// Runtime "public-URL or bust" safety check
function validateAndGetBaseUrl() {
  // Allow environment override, but default to public URL
  const configuredUrl = process.env.PASSPORT_PROXY_BASE_URL || PUBLIC_PASSPORT_PROXY_URL;
  
  try {
    const url = new URL(configuredUrl);
    
    // Safety check: if using vercel.app domain, ensure it's the correct subdomain
    if (url.hostname.endsWith('.vercel.app') && url.hostname !== 'coco-passport-proxy.vercel.app') {
      console.error(
        `[SAFETY CHECK] Configured base URL '${configuredUrl}' uses vercel.app domain ` +
        `with incorrect subdomain '${url.hostname}'. This could be a TestFlight build drift. ` +
        `Falling back to public URL: ${PUBLIC_PASSPORT_PROXY_URL}`
      );
      return PUBLIC_PASSPORT_PROXY_URL;
    }
    
    return configuredUrl;
  } catch (error) {
    console.error(
      `[SAFETY CHECK] Invalid base URL '${configuredUrl}': ${error.message}. ` +
      `Falling back to public URL: ${PUBLIC_PASSPORT_PROXY_URL}`
    );
    return PUBLIC_PASSPORT_PROXY_URL;
  }
}

// Base URL constant for the passport proxy service (with safety check applied)
const PASSPORT_PROXY_BASE_URL = validateAndGetBaseUrl();

// --- tiny helpers ------------------------------------------------------------
const parseBody = (req) => new Promise((resolve, reject) => {
  let data = ''; req.on('data', c => data += c);
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});
async function fetchJson(url, opts={}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, json: JSON.parse(text), text }; }
  catch { return { ok: r.ok, status: r.status, json: null, text }; }
}
function sendCORS(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Accept-Profile, Content-Profile');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}
function pad(n){return n<10?'0'+n:String(n)}
function fmtDate(d, fmt){ return fmt.replace('%m', pad(d.getMonth()+1)).replace('%d', pad(d.getDate())).replace('%Y', d.getFullYear()) }
function resolveTemplateDates(urlStr){
  try{
    const now = new Date();
    const tmr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1)); // “tomorrow” UTC
    return urlStr
      .replace(/{start:%([^}]+)}/g, (_,fmt)=>fmtDate(tmr, '%'+fmt))
      .replace(/{end:%([^}]+)}/g,   (_,fmt)=>fmtDate(tmr, '%'+fmt));
  }catch{ return urlStr }
}

// Resolver bits
const ROOM_ORDER = ["A3","A4","A5","A6","A7","A8","A9","B6","B7","B8","B9","Double House","Jungle House","Beach House","New House"];
const TWO_WORD_ROOMS = ["Double House","Jungle House","Beach House","New House"];
const ONE_WORD_ROOMS = ["A3","A4","A5","A6","A7","A8","A9","B6","B7","B8","B9"];
function cap1(s){ if(!s) return s; return s[0].toUpperCase()+s.slice(1).toLowerCase(); }
function normalizeStayIdFreeform(raw){
  if (!raw) return { input:'', rooms_in:'', last_in:'', rooms:[], last_name_canonical:'', stay_id:'' };
  const cleaned = String(raw).trim().replace(/[,\.;:]+/g,' ');
  const parts = cleaned.split(/[\s_]+/).filter(Boolean);
  const used = new Array(parts.length).fill(false);
  let rooms = [];

  // two-word rooms
  for (let i=0;i<parts.length-1;i++){
    if (used[i]||used[i+1]) continue;
    const two = (parts[i]+' '+parts[i+1]).toLowerCase();
    const match = TWO_WORD_ROOMS.find(r=>r.toLowerCase()===two);
    if (match){ rooms.push(match); used[i]=used[i+1]=true; }
  }
  // one-word rooms and A/B numbers
  for (let i=0;i<parts.length;i++){
    if (used[i]) continue;
    const t = parts[i].toLowerCase();
    const one = ONE_WORD_ROOMS.find(r=>r.toLowerCase()===t);
    if (one){ rooms.push(one); used[i]=true; continue; }
    if (/^[ab][0-9]+$/.test(t)){
      const canon=t.toUpperCase();
      if (ROOM_ORDER.includes(canon)){ rooms.push(canon); used[i]=true; }
    }
  }
  const lastParts = parts.filter((_,i)=>!used[i]);
  let lastNameCanonical = lastParts.map(cap1).join('').replace(/[\s-]+/g,'');
  rooms = Array.from(new Set(rooms));
  rooms.sort((a,b)=>ROOM_ORDER.indexOf(a)-ROOM_ORDER.indexOf(b));
  // Ensure stay_id always uses underscores: replace all whitespace with _, collapse multiple _, trim
  const stay_id = [...rooms, lastNameCanonical].filter(Boolean).join('_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
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
  // ---------- HOTFIX: force-table route ----------
  try {
    const urlObj = new URL(req.url, 'https://x.local');
    if (req.method === 'POST' && urlObj.pathname === '/insert-table') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // read body (no for-await)
      const raw = await new Promise((resolve,reject)=>{
        try{
          const chunks=[]; req.on('data',c=>chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c)));
          req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
          req.on('error',reject);
        }catch(e){ resolve(''); }
      });
      let body={}; try{ body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      const rows = Array.isArray(body.rows) ? body.rows : null;
      if (!rows) { res.statusCode=400; return res.end(JSON.stringify({ ok:false, error:'rows (array) required' })); }

      // normalize photo_urls -> []
      const payload = rows.map(r => ({ ...r, photo_urls: Array.isArray(r.photo_urls) ? r.photo_urls.filter(Boolean) : [] }));

      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env || {};
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        res.statusCode=500; return res.end(JSON.stringify({ ok:false, error:'missing SUPABASE envs' }));
      }

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
        body: JSON.stringify(payload)
      });
      const txt = await r.text();
      let data; try { data = JSON.parse(txt); } catch { data = []; }
      if (!r.ok) {
        res.statusCode=r.status;
        return res.end(JSON.stringify({ ok:false, error:'supabase insert failed', status:r.status, body: txt.slice(0,400) }));
      }
      const inserted = Array.isArray(data) ? data.length : (Array.isArray(data.rows)?data.rows.length:payload.length);
      return res.end(JSON.stringify({ ok:true, via:'table', inserted, rows:data }));
    }
  } catch(_) {}
  // ---------- END HOTFIX ----------
  // ---- force table-backed /insert that returns an object (not [] ) ----
  try {
    const __u = new URL(req.url, 'http://x'); // safe parse
    if (req.method === 'POST' && __u.pathname === '/insert') {
      res.setHeader('Content-Type','application/json; charset=utf-8');
      // read body safely
      const raw = await new Promise((resolve,reject)=>{
        try{
          let d=[]; req.on('data',c=>d.push(Buffer.isBuffer(c)?c:Buffer.from(c)));
          req.on('end',()=>resolve(Buffer.concat(d).toString('utf8')));
          req.on('error',reject);
        }catch(e){ resolve(''); }
      });

      let body={}; try{ body = raw ? JSON.parse(raw) : {}; } catch{ body = {}; }
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!rows.length) { res.statusCode=400; return res.end(JSON.stringify({ ok:false, error:'rows (array) required' })); }

      // clean photos to array-of-strings
      const payload = rows.map(r => ({ 
        ...r, 
        photo_urls: Array.isArray(r.photo_urls) ? r.photo_urls.filter(Boolean) : [] 
      }));

      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env || {};
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        res.statusCode=500; return res.end(JSON.stringify({ ok:false, error:'missing SUPABASE envs' }));
      }

      // PostgREST table insert with idempotent merge-duplicates
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
        body: JSON.stringify(payload)
      });
      const txt = await r.text();
      // best-effort parse of what PostgREST returns
      let data; try { data = JSON.parse(txt); } catch { data = []; }

      if (!r.ok) {
        // bubble useful error but still structured
        return res.end(JSON.stringify({ ok:false, error:'supabase insert failed', status:r.status, body: txt.slice(0,400) }));
      }

      const inserted = Array.isArray(data) ? data.length : (Array.isArray(data.rows)?data.rows.length:rows.length);
      return res.end(JSON.stringify({ ok:true, via:'table', inserted, rows: data }));
    }
  } catch(_e) { /* ignore, fall through to existing routes */ }
  // CORS
  if (sendCORS(req,res)) return;

  // URL + path normalize
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { res.statusCode=400; res.end('Bad URL'); return; }
  url.pathname = (url.pathname.replace(/\/+$/,'') || '/');

  // Health
  if (req.method==='GET' && url.pathname==='/') { res.setHeader('Content-Type','text/plain'); res.end('OK: coco-passport-proxy'); return; }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEET_FEED_URL } = process.env || {};
  const baseHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Accept-Profile': 'public',
    'Content-Profile': 'public'
  };

  // --- /resolve ----------------------------------------------------------------
  if (req.method==='GET' && url.pathname==='/resolve'){
    const q = url.searchParams.get('stay_id') || '';
    const out = normalizeStayIdFreeform(q);
    res.setHeader('Content-Type','application/json'); 
    res.end(JSON.stringify(out)); 
    return;
  }

  // --- /upload (binary) --------------------------------------------------------
  if (req.method==='POST' && url.pathname==='/upload'){
    try{
      const stay_id = url.searchParams.get('stay_id'); const filename = (url.searchParams.get('filename')||`${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g,'_');
      if (!stay_id){ res.statusCode=400; res.end(JSON.stringify({ok:false,error:'stay_id required'})); return; }
      const objectPath = `passports/${stay_id}/${filename}`;
      const chunks=[]; for await (const c of req) chunks.push(c); const buf = Buffer.concat(chunks);
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method:'POST',
        headers:{ apikey:SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/octet-stream', 'x-upsert':'true' },
        body: buf
      });
      const t = await put.text();
      if (!put.ok){ res.statusCode=put.status; res.end(JSON.stringify({ok:false,error:'storage upload failed', body:t})); return; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true, object_path:objectPath})); return;
    }catch(e){ res.statusCode=500; res.end(JSON.stringify({ok:false,error:e.message||'upload error'})); return; }
  }

  // --- /upload-url (server fetches from URL) -----------------------------------
  if (req.method==='POST' && url.pathname==='/upload-url'){
    try{
      const { stay_id, url:imgUrl, filename } = await parseBody(req);
      if (!stay_id || !imgUrl){ res.statusCode=400; res.end(JSON.stringify({ok:false,error:'stay_id and url required'})); return; }
      const safeName=(filename||`${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g,'_');
      const objectPath = `passports/${stay_id}/${safeName}`;
      
      // Honor SKIP_UPLOADS=1 for CI/testing - bypass Supabase storage
      if (process.env.SKIP_UPLOADS === '1'){ res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true, object_path:objectPath, skipped:true})); return; }
      
      const fr = await fetch(imgUrl); if (!fr.ok){ const tt = await fr.text(); res.statusCode=400; res.end(JSON.stringify({ok:false,error:`fetch image failed: ${fr.status}`, body:tt})); return; }
      const buf = Buffer.from(await fr.arrayBuffer());
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method:'POST', headers:{ apikey:SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/octet-stream', 'x-upsert':'true' }, body:buf
      });
      const t = await put.text();
      if (!put.ok){ res.statusCode=put.status; res.end(JSON.stringify({ok:false,error:'storage upload failed', body:t})); return; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true, object_path:objectPath})); return;
    }catch(e){ res.statusCode=500; res.end(JSON.stringify({ok:false,error:e.message||'upload-url error'})); return; }
  }

  // --- /insert (RPC first, fallback table) ------------------------------------
  if (req.method==='POST' && url.pathname==='/insert'){
    const body = await parseBody(req).catch(()=>({}));
    const rows = Array.isArray(body.rows)? body.rows : [];
    if (!rows.length){ res.setHeader('Content-Type','application/json'); res.statusCode=400; res.end(JSON.stringify({ok:false,error:'rows (array) required'})); return; }

    // RPC try
    const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, { method:'POST', headers: baseHeaders, body: JSON.stringify(body) });
    if (rpc.ok){ 
      const text = await rpc.text(); 
      // Wrap RPC response in iOS-expected envelope format
      let rpcData;
      try { rpcData = JSON.parse(text || '[]'); } catch { rpcData = []; }
      const inserted = Array.isArray(rpcData) ? rpcData.length : 0;
      res.setHeader('Content-Type','application/json'); 
      res.statusCode=200; 
      res.end(JSON.stringify({ ok:true, via:'rpc', inserted, rows: rpcData })); 
      return; 
    }

    // fallback table insert
    const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
      method:'POST', headers:{ ...baseHeaders, Prefer:'return=representation' }, body: JSON.stringify(rows)
    });
    const txt = await tbl.text();
    if (!tbl.ok){ res.statusCode=tbl.status; res.end(JSON.stringify({ok:false,status:tbl.status,error:txt,via:'table'})); return; }

    // detect duplicates from PostgREST payload (if any)
    let inserted=0, skipped=[];
    try{
      const js = JSON.parse(txt);
      inserted = Array.isArray(js)? js.length : 0;
    }catch{}
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ ok:true, via:'table', inserted, skipped }));
    return;
  }

  // --- /export (tab-delimited 7 cols, header) ---------------------------------
  if (req.method==='GET' && url.pathname==='/export'){
    const stay_id = url.searchParams.get('stay_id');
    const rooms = url.searchParams.get('rooms');
    const last = url.searchParams.get('last');
    let effectiveStay = stay_id;
    if (!effectiveStay && (rooms || last)){
      const label = [rooms||'', last||''].join(' ').trim();
      const r = normalizeStayIdFreeform(label);
      effectiveStay = r.stay_id;
    }
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    if (!effectiveStay){ res.end('First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday'); return; }

    const qs = new URLSearchParams({
      'stay_id': `eq.${effectiveStay}`,
      'order': 'created_at.asc',
      'select': '"First Name","Middle Name","Last Name","Gender","Passport Number","Nationality","Birthday"'
    }).toString();

    const r = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests_export_view?${qs}`, { headers: baseHeaders });
    const txt = await r.text();
    if (!r.ok){ res.statusCode=r.status; res.end('First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday'); return; }

    let out = 'First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday';
    try{
      const arr = JSON.parse(txt);
      for (const row of arr){
        out += `\n${row["First Name"]||''}\t${row["Middle Name"]||''}\t${row["Last Name"]||''}\t${row["Gender"]||''}\t${row["Passport Number"]||''}\t${row["Nationality"]||''}\t${row["Birthday"]||''}`;
      }
    }catch{}
    res.end(out); return;
  }

  // --- /status (one-line) -----------------------------------------------------
  if (req.method==='GET' && url.pathname==='/status'){
    const stay_id = url.searchParams.get('stay_id');
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    if (!stay_id){ res.end('0 of ? passports received 📸'); return; }
    const qs = new URLSearchParams({ 'stay_id': `eq.${stay_id}` }).toString();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?${qs}`, { headers: baseHeaders });
    const txt = await r.text();
    if (!r.ok){ res.statusCode=r.status; res.end('0 of ? passports received 📸'); return; }
    try{ const arr = JSON.parse(txt); res.end(arr[0]?.status || '0 of ? passports received 📸'); }
    catch{ res.end('0 of ? passports received 📸'); }
    return;
  }

  // --- /tokeet-upsert (pull feed URL, preseed) --------------------------------
  if (url.pathname==='/tokeet-upsert'){
    if (req.method!=='POST'){ res.statusCode=405; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:false,error:'Method Not Allowed. Use POST.'})); return; }
    try{
      const body = await parseBody(req).catch(()=>({}));
      const feedUrlRaw = body.feed_url || TOKEET_FEED_URL;
      if (!feedUrlRaw){ res.statusCode=400; res.end(JSON.stringify({ ok:false, error:'missing feed_url (body) or TOKEET_FEED_URL env' })); return; }
      const feedUrl = resolveTemplateDates(feedUrlRaw);
      const feed = await fetchJson(feedUrl);
      if (!feed.ok){ res.statusCode=feed.status||500; res.end(JSON.stringify({ ok:false, error:'fetch feed failed', body: feed.text })); return; }

      const items = Array.isArray(feed.json) ? feed.json : (feed.json?.items || []);
      const rows=[];
      for (const it of items){
        const label = `${(it.rooms||'').toString()} ${(it.last||it.guest_last||'').toString()}`.trim();
        const r = normalizeStayIdFreeform(label);
        const stay_id = r.stay_id; if (!stay_id) continue;
        rows.push({
          stay_id,
          rooms: Array.isArray(r.rooms) ? r.rooms : [],
          check_in: it.check_in || null,
          check_out: it.check_out || null,
          expected_guest_count: it.expected_guest_count ?? it.guests ?? null
        });
      }
      if (!rows.length){ res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, upserted:0 })); return; }

      const put = await fetch(`${SUPABASE_URL}/rest/v1/stays_preseed`, {
        method:'POST', headers:{ ...baseHeaders, Prefer:'resolution=merge-duplicates' }, body: JSON.stringify(rows)
      });
      const txt = await put.text();
      if (!put.ok){ res.statusCode=put.status; res.end(JSON.stringify({ ok:false, error:'upsert failed', body:txt })); return; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, upserted: rows.length })); return;
    }catch(e){ res.statusCode=500; res.end(JSON.stringify({ ok:false, error:e.message||'tokeet-upsert error' })); return; }
  }

  // --- /tokeet-upsert-rows (DIRECT preseed) -----------------------------------
  if (req.method==='POST' && url.pathname==='/tokeet-upsert-rows'){
    try{
      const body = await parseBody(req).catch(()=>({}));
      const rows = Array.isArray(body.rows)? body.rows : [];
      if (!rows.length){ res.statusCode=400; res.end(JSON.stringify({ ok:false, error:'rows (array) required' })); return; }
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){ res.statusCode=500; res.end(JSON.stringify({ ok:false, error:'missing SUPABASE envs' })); return; }

      const put = await fetch(`${SUPABASE_URL}/rest/v1/stays_preseed`, {
        method:'POST',
        headers:{ ...baseHeaders, Prefer:'resolution=merge-duplicates' },
        body: JSON.stringify(rows)
      });
      const txt = await put.text();
      if (!put.ok){ res.statusCode=put.status; res.end(JSON.stringify({ ok:false, error:'upsert failed', body:txt })); return; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, upserted: rows.length })); return;
    }catch(e){ res.statusCode=500; res.end(JSON.stringify({ ok:false, error:e.message||'tokeet-upsert-rows error' })); return; }
  }

  // Fallback
  res.statusCode = 404;
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({ ok:false, error:'Not Found' }));
};
