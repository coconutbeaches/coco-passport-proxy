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
  // ---- (removed duplicate /insert hotfix route) ----
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

  // --- /insert (RPC first, fallback table with upsert) ------------------------------------
  if (req.method==='POST' && url.pathname==='/insert'){
    const body = await parseBody(req).catch(()=>({}));
    const rows = Array.isArray(body.rows)? body.rows : [];
    if (!rows.length){ res.setHeader('Content-Type','application/json'); res.statusCode=400; res.end(JSON.stringify({ok:false,error:'rows (array) required'})); return; }

    // RPC try first
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

    // Manual upsert logic: check for existing records, update if found, insert if not
    let inserted = 0, updated = 0, skipped = 0;
    const results = [];
    
    for (const row of rows) {
      if (!row.stay_id || !row.first_name) {
        skipped++;
        continue;
      }
      
      // Check if record exists
      const checkUrl = `${SUPABASE_URL}/rest/v1/incoming_guests?stay_id=eq.${encodeURIComponent(row.stay_id)}&first_name=ilike.${encodeURIComponent(row.first_name)}&limit=1`;
      const check = await fetch(checkUrl, { headers: baseHeaders });
      
      if (!check.ok) {
        skipped++;
        continue;
      }
      
      const existing = await check.json();
      
      if (existing && existing.length > 0) {
        // Record exists - update it
        const existingId = existing[0].id;
        const updateUrl = `${SUPABASE_URL}/rest/v1/incoming_guests?id=eq.${existingId}`;
        const updateData = { ...row };
        delete updateData.stay_id; // Don't update the key fields
        delete updateData.first_name;
        
        const updateResp = await fetch(updateUrl, {
          method: 'PATCH',
          headers: { ...baseHeaders, Prefer: 'return=representation' },
          body: JSON.stringify(updateData)
        });
        
        if (updateResp.ok) {
          const updatedRecord = await updateResp.json();
          results.push(...(Array.isArray(updatedRecord) ? updatedRecord : [updatedRecord]));
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Record doesn't exist - insert it
        const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
          method: 'POST',
          headers: { ...baseHeaders, Prefer: 'return=representation' },
          body: JSON.stringify([row])
        });
        
        if (insertResp.ok) {
          const insertedRecord = await insertResp.json();
          results.push(...(Array.isArray(insertedRecord) ? insertedRecord : [insertedRecord]));
          inserted++;
        } else {
          skipped++;
        }
      }
    }
    
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ 
      ok: true, 
      via: 'table-manual-upsert', 
      inserted, 
      updated, 
      skipped, 
      rows: results 
    }));
    return;
  }

  // --- /passport (direct PostgreSQL merge-or-insert) --------------------------
  if (req.method === 'POST' && url.pathname === '/passport') {
    const { Pool } = require('pg');
    
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    try {
      const body = await parseBody(req).catch(() => ({}));
      const {
        stay_id,
        first_name,
        middle_name,
        last_name,
        gender,
        birthday,
        passport_number,
        nationality_alpha3,
        photo_urls,
        source
      } = body;

      if (!stay_id || !first_name) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: "stay_id and first_name are required" }));
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 1️⃣ Try merge update first
        const updateQuery = `
          UPDATE incoming_guests
          SET
            last_name = COALESCE(NULLIF($1, ''), last_name),
            middle_name = COALESCE(NULLIF($2, ''), middle_name),
            gender = COALESCE(NULLIF($3, ''), gender),
            birthday = COALESCE(NULLIF($4::date, NULL), birthday),
            passport_number = COALESCE(NULLIF($5, ''), passport_number),
            nationality_alpha3 = COALESCE(NULLIF($6, ''), nationality_alpha3),
            photo_urls = CASE
              WHEN $7::text[] IS NOT NULL AND array_length($7::text[], 1) > 0
              THEN $7::text[]
              ELSE photo_urls
            END,
            source = COALESCE(NULLIF($8, ''), source)
          WHERE stay_id = $9
            AND lower(first_name) = lower($10)
        `;
        const updateValues = [
          last_name || "",
          middle_name || "",
          gender || "",
          birthday || null,
          passport_number || "",
          nationality_alpha3 || "",
          photo_urls && photo_urls.length > 0 ? photo_urls : null,
          source || "api_merge",
          stay_id,
          first_name
        ];
        const updateResult = await client.query(updateQuery, updateValues);

        // 2️⃣ If no update happened, insert new row
        if (updateResult.rowCount === 0) {
          const insertQuery = `
            INSERT INTO incoming_guests (
              stay_id, first_name, middle_name, last_name, gender,
              birthday, passport_number, nationality_alpha3, photo_urls, source
            ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10)
          `;
          await client.query(insertQuery, [
            stay_id,
            first_name,
            middle_name || "",
            last_name || "",
            gender || "",
            birthday || null,
            passport_number || "",
            nationality_alpha3 || "",
            photo_urls && photo_urls.length > 0 ? photo_urls : null,
            source || "api_insert"
          ]);
        }

        await client.query("COMMIT");
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          success: true, 
          action: updateResult.rowCount > 0 ? "merged" : "inserted" 
        }));
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- /merge-passport (direct PostgreSQL merge-or-insert) --------------------
  if (req.method === 'POST' && url.pathname === '/merge-passport') {
    const { Pool } = require('pg');
    
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    try {
      const body = await parseBody(req).catch(() => ({}));
      const {
        stay_id,
        first_name,
        middle_name,
        last_name,
        gender,
        birthday,
        passport_number,
        nationality_alpha3,
        photo_urls,
        source
      } = body;

      if (!stay_id || !first_name) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: "stay_id and first_name are required" }));
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Try merge update first
        const updateQuery = `
          UPDATE incoming_guests
          SET
            last_name = COALESCE(NULLIF($1, ''), last_name),
            middle_name = COALESCE(NULLIF($2, ''), middle_name),
            gender = COALESCE(NULLIF($3, ''), gender),
            birthday = COALESCE(NULLIF(NULLIF($4, '')::date, NULL), birthday),
            passport_number = COALESCE(NULLIF($5, ''), passport_number),
            nationality_alpha3 = COALESCE(NULLIF($6, ''), nationality_alpha3),
            photo_urls = CASE
              WHEN $7::text[] IS NOT NULL AND array_length($7::text[], 1) > 0
              THEN $7::text[]
              ELSE photo_urls
            END,
            source = COALESCE(NULLIF($8, ''), source)
          WHERE stay_id = $9
            AND lower(first_name) = lower($10)
        `;
        const updateValues = [
          last_name || "",
          middle_name || "",
          gender || "",
          birthday || "",
          passport_number || "",
          nationality_alpha3 || "",
          photo_urls && photo_urls.length > 0 ? photo_urls : null,
          source || "coco_gpt_merge",
          stay_id,
          first_name
        ];
        const updateResult = await client.query(updateQuery, updateValues);

        // If no update happened, insert new row
        if (updateResult.rowCount === 0) {
          const insertQuery = `
            INSERT INTO incoming_guests (
              stay_id, first_name, middle_name, last_name, gender,
              birthday, passport_number, nationality_alpha3, photo_urls, source
            )
            VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::date, $7, $8, $9, $10)
          `;
          await client.query(insertQuery, [
            stay_id,
            first_name,
            middle_name || "",
            last_name || "",
            gender || "",
            birthday || "",
            passport_number || "",
            nationality_alpha3 || "",
            photo_urls && photo_urls.length > 0 ? photo_urls : null,
            source || "coco_gpt_insert"
          ]);
        }

        await client.query("COMMIT");

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          success: true,
          action: updateResult.rowCount > 0 ? "merged" : "inserted"
        }));
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
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

      let items = [];
      
      // Check if response is JSON or CSV
      if (feed.json && Array.isArray(feed.json)) {
        // JSON format (original logic)
        items = feed.json;
      } else if (feed.text && feed.text.includes('"Name"')) {
        // CSV format - parse it
        const csvLines = feed.text.split('\n').filter(line => line.trim());
        const headers = csvLines[0].split(',').map(h => h.replace(/"/g, '').trim());
        
        for (let i = 1; i < csvLines.length; i++) {
          const values = [];
          let current = '';
          let inQuotes = false;
          
          // Simple CSV parser that handles quoted values
          for (let char of csvLines[i]) {
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              values.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          values.push(current.trim()); // Add the last value
          
          // Create item object from CSV row
          const item = {};
          headers.forEach((header, index) => {
            item[header] = values[index] || '';
          });
          
          // Map CSV fields to expected format
          if (item.Name && item.Rental) {
            // Extract room from Rental field like "A4 · 1 Bedroom / 1 Bath at Coconut Beach Bungalows (A4)"
            const roomMatch = item.Rental.match(/\(([AB]\d+)\)/) || item.Rental.match(/^([AB]\d+)/);
            const room = roomMatch ? roomMatch[1] : '';
            
            // Extract room from house names like "Beach House", "Jungle House", etc.
            const houseMatch = item.Rental.match(/(Beach House|Jungle House|Double House|New House)/);
            const house = houseMatch ? houseMatch[1] : '';
            
            items.push({
              rooms: room || house || '',
              full_name: item.Name,
              last: item.Name.split(' ').pop(), // Use last word as last name
              first: item.Name.split(' ')[0], // Use first word as first name
              guest_last: item.Name.split(' ').pop(),
              check_in: item.Arrive || null,
              check_out: item.Depart || null,
              guests: parseInt(item.Adults || '0') + parseInt(item.Children || '0') || null,
              expected_guest_count: parseInt(item.Adults || '0') + parseInt(item.Children || '0') || null
              // Additional CSV field mappings
              email: item.Email || "",
              phone: item.Telephone || "",
              rental_unit: item.Rental || "",
              nights: parseInt(item.Nights || "0") || null,
              booking_id: item["Booking ID"] || "",
              booking_channel: item.Source || "",
              adults: parseInt(item.Adults || "0") || 0,
              children: parseInt(item.Children || "0") || 0,
              currency: item.Currency || "",
              total_cost: parseFloat(item["Total Cost"] || "0") || 0            });
          }
        }
      } else {
        // Fallback - try to use existing JSON structure
        items = feed.json?.items || [];
      }

      const rawRows = [];
      
      // First pass: normalize each item individually
      for (const it of items){
        const label = `${(it.rooms||'').toString()} ${(it.last||it.guest_last||'').toString()}`.trim();
        const r = normalizeStayIdFreeform(label);
        if (!r.stay_id) continue;
        
        rawRows.push({
          ...r,
          original_item: it,
          raw_last_name: (it.last||it.guest_last||'').toString().trim()
        });
      }

      // Second pass: merge rooms for guests with same last name
      const guestsByLastName = {};
      rawRows.forEach(row => {
        // Remove spaces from last name for comparison
        const cleanLastName = row.raw_last_name.replace(/\s+/g, '');
        if (!guestsByLastName[cleanLastName]) {
          guestsByLastName[cleanLastName] = [];
        }
        guestsByLastName[cleanLastName].push(row);
      });

      const guestRows = [];
      Object.entries(guestsByLastName).forEach(([cleanLastName, guestRows_temp]) => {
        if (guestRows_temp.length === 1) {
          // Single guest - create one guest record
          const row = guestRows_temp[0];
          const roomsPart = row.rooms.join('_');
          const stay_id = roomsPart ? `${roomsPart}_${cleanLastName}` : cleanLastName;
          
          guestRows.push({
            stay_id,
            first_name: cap1(row.original_item.first) || cap1(row.original_item.full_name?.split(" ")[0]) || "",
            last_name: cleanLastName,
            email: row.original_item.email || "",
            phone: row.original_item.phone || "",
            rental_unit: row.original_item.rental_unit || "",
            check_out: row.original_item.check_out || null,
            nights: row.original_item.nights || null,
            booking_id: row.original_item.booking_id || "",
            booking_channel: row.original_item.booking_channel || "",
            adults: row.original_item.adults || 0,
            children: row.original_item.children || 0,
            currency: row.original_item.currency || "",
            total_cost: row.original_item.total_cost || 0,            source: 'tokeet_upsert'
          });
        } else {
          // Multiple guests with same last name - merge rooms, create one guest record
          const allRooms = [];
          let sampleItem = null;
          
          guestRows_temp.forEach(row => {
            allRooms.push(...row.rooms);
            if (!sampleItem) sampleItem = row.original_item;
          });
          
          // Remove duplicates and sort by room order
          const uniqueRooms = Array.from(new Set(allRooms));
          uniqueRooms.sort((a,b) => ROOM_ORDER.indexOf(a) - ROOM_ORDER.indexOf(b));
          
          const stay_id = uniqueRooms.length ? `${uniqueRooms.join('_')}_${cleanLastName}` : cleanLastName;
          
          guestRows.push({
            stay_id,
            first_name: cap1(sampleItem.first) || cap1(sampleItem.full_name?.split(" ")[0]) || "",
            last_name: cleanLastName,
            email: row.original_item.email || "",
            phone: row.original_item.phone || "",
            rental_unit: row.original_item.rental_unit || "",
            check_out: row.original_item.check_out || null,
            nights: row.original_item.nights || null,
            booking_id: row.original_item.booking_id || "",
            booking_channel: row.original_item.booking_channel || "",
            adults: row.original_item.adults || 0,
            children: row.original_item.children || 0,
            currency: row.original_item.currency || "",
            total_cost: row.original_item.total_cost || 0,            source: 'tokeet_upsert'
          });
        }
      });

      if (!guestRows.length){ res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, upserted:0 })); return; }

      // Insert into incoming_guests table instead of stays_preseed
      const put = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
        method:'POST', headers:{ ...baseHeaders, Prefer:'resolution=merge-duplicates' }, body: JSON.stringify(guestRows)
      });
      const txt = await put.text();
      if (!put.ok){ res.statusCode=put.status; res.end(JSON.stringify({ ok:false, error:'upsert failed', body:txt })); return; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, upserted: guestRows.length })); return;
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


async function mergeOrInsertPassport(db, newGuest) {
  const { stay_id, first_name, last_name, gender, birthday, passport_number, nationality_alpha3, photo_urls, source } = newGuest;

  // Look for an existing row with same stay_id + first_name (case-insensitive)
  const existing = await db.query(
    `SELECT * FROM incoming_guests
     WHERE stay_id = $1 AND lower(first_name) = lower($2)
     LIMIT 1`,
    [stay_id.trim(), first_name.trim()]
  );

  if (existing.rows.length > 0) {
    const ex = existing.rows[0];
    if (!ex.passport_number) {
      // Merge instead of insert
      await db.query(`
        UPDATE incoming_guests t
        SET
          last_name = COALESCE(NULLIF($1, ''), t.last_name),
          middle_name = COALESCE(NULLIF($2, ''), t.middle_name),
          gender = COALESCE(NULLIF($3, ''), t.gender),
          birthday = COALESCE(NULLIF($4, '')::date, t.birthday),
          passport_number = COALESCE(NULLIF($5, ''), t.passport_number),
          nationality_alpha3 = COALESCE(NULLIF($6, ''), t.nationality_alpha3),
          photo_urls = CASE WHEN $7::jsonb IS NOT NULL AND jsonb_array_length($7::jsonb) > 0 THEN $7::jsonb ELSE t.photo_urls END,
          source = COALESCE(NULLIF($8, ''), t.source)
        WHERE t.id = $9
      `, [
        last_name, newGuest.middle_name || '',
        gender, birthday,
        passport_number, nationality_alpha3,
        JSON.stringify(photo_urls || []), source,
        ex.id
      ]);
      console.log(`Merged passport into existing guest: ${first_name} (${stay_id})`);
      return;
    }
  }

  // No match or passport already present — insert new row
  await db.query(`
    INSERT INTO incoming_guests (stay_id, first_name, middle_name, last_name, gender, birthday, passport_number, nationality_alpha3, photo_urls, source)
    VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::date, $7, $8, $9::jsonb, $10)
  `, [
    stay_id, first_name, newGuest.middle_name || '', last_name,
    gender, birthday, passport_number, nationality_alpha3,
    JSON.stringify(photo_urls || []), source
  ]);
}

// --- Automatic merge_passport fallback --------------------------------------
async function handlePassportUpsertOrMerge(passportData) {
  // Step 1: Try upsert
  const upsertResp = await fetchJson(`${PASSPORT_PROXY_BASE_URL}/upsertPassport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [passportData] })
  });

  if (!upsertResp.ok) {
    console.error("Upsert failed", upsertResp.status, upsertResp.text);
    return upsertResp;
  }

  // Step 2: If no insert happened, call merge_passport
  if (upsertResp.json && upsertResp.json.inserted === 0) {
    console.log(`No new row inserted for stay_id=${passportData.stay_id}, first_name=${passportData.first_name}. Merging...`);

    const mergeResp = await fetchJson(`${process.env.SUPABASE_URL}/rest/v1/rpc/merge_passport`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        p_stay_id: passportData.stay_id,
        p_first_name: passportData.first_name,
        p_middle_name: passportData.middle_name || '',
        p_last_name: passportData.last_name || '',
        p_gender: passportData.gender || '',
        p_birthday: passportData.birthday || null,
        p_passport_number: passportData.passport_number || '',
        p_nationality_alpha3: passportData.nationality_alpha3 || '',
        p_photo_urls: passportData.photo_urls || [],
        p_source: passportData.source || ''
      })
    });

    if (!mergeResp.ok) {
      console.error("Merge failed", mergeResp.status, mergeResp.text);
    } else {
      console.log(`Merge completed for ${passportData.first_name} (${passportData.stay_id})`);
    }
    return mergeResp;
  }

  return upsertResp;
}
