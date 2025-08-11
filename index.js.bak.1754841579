/**
 * coco-passport-proxy — single-file Vercel serverless function
 * - Health: GET /
 * - Resolve: GET /resolve?stay_id=...
 * - Upload binary: POST /upload?stay_id=...&filename=...
 * - Upload from URL: POST /upload-url { stay_id, url, filename? }
 * - Insert: POST /insert[?via=table] { rows: [...] }
 * - Export: GET /export?stay_id=...
 * - Status: GET /status?stay_id=...
 * - Recent: GET /recent?limit=10
 */
const crypto = require('crypto');

const parseBody = (req) => new Promise((resolve, reject) => {
  try {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { return reject(e); }
    });
    req.on('error', reject);
  } catch (e) { reject(e); }
});

// ---------- Config ----------
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

const baseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  'Accept-Profile': 'public',
  'Content-Profile': 'public'
};

// Canonical room ordering (A*, B*, then named houses)
const ROOM_ORDER = [
  "A3","A4","A5","A6","A7","A8","A9",
  "B6","B7","B8","B9",
  "Double House","Jungle House","Beach House","New House"
];

// ---------- Helpers ----------
const cap1 = s => s ? (s[0].toUpperCase() + s.slice(1).toLowerCase()) : s;

/**
 * normalizeStayIdFreeform
 * Accepts messy input like:
 *   "b8, a9   DUPÔNT" → rooms ["A9","B8"], last "Dupônt" → stay_id "A9_B8_Dupônt"
 *   "double house teulon" → rooms ["Double House"], last "Teulon" → "Double_House_Teulon"
 *   "a5 double house miller" → rooms ["A5","Double House"] → "A5_Double_House_Miller"
 */
function normalizeStayIdFreeform(rawInput) {
  const raw = String(rawInput || '').trim();
  if (!raw) {
    return {
      input: '',
      rooms_in: '',
      last_in: '',
      rooms: [],
      last_name_canonical: '',
      stay_id: ''
    };
  }

  // Tokenize: turn commas/underscores into spaces, collapse, strip stray punctuation on edges
  const cleaned = raw
    .replace(/[_,-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const TOKENS = cleaned.split(' ').filter(Boolean);
  const used = new Array(TOKENS.length).fill(false);

  const twoWordRooms = ["Double House","Jungle House","Beach House","New House"];
  const singleWordRooms = ["A3","A4","A5","A6","A7","A8","A9","B6","B7","B8","B9"];

  let rooms = [];

  // 1) Match 2-word rooms (case-insensitive)
  for (let i = 0; i < TOKENS.length - 1; i++) {
    if (used[i] || used[i+1]) continue;
    const cand = `${TOKENS[i]} ${TOKENS[i+1]}`.toLowerCase();
    const hit = twoWordRooms.find(r => r.toLowerCase() === cand);
    if (hit) {
      rooms.push(hit);
      used[i] = used[i+1] = true;
    }
  }

  // 2) Match single-word rooms and A*/B* codes irrespective of case
  for (let i = 0; i < TOKENS.length; i++) {
    if (used[i]) continue;
    const t = TOKENS[i].toUpperCase();
    if (singleWordRooms.includes(t)) {
      rooms.push(t);
      used[i] = true;
      continue;
    }
    // Also accept A5/a5/B8/b8 patterns
    if (/^[AB]\d+$/.test(t) && ROOM_ORDER.includes(t)) {
      rooms.push(t);
      used[i] = true;
    }
  }

  // 3) Remaining tokens are last name parts; TitleCase each and glue (no spaces/hyphens)
  const lastParts = TOKENS.filter((_, idx) => !used[idx]);
  let lastNameCanonical = lastParts.map(cap1).join('').replace(/[\s-]+/g, '');

  // 4) De-dup and sort rooms according to ROOM_ORDER
  rooms = Array.from(new Set(rooms));
  rooms.sort((a,b) => ROOM_ORDER.indexOf(a) - ROOM_ORDER.indexOf(b));

  // 5) Build stay_id; underscore multi-word rooms
  const stay_id = [
    ...rooms.map(r => r.replace(/ /g, '_')),
    lastNameCanonical
  ].filter(Boolean).join('_');

  return {
    input: raw,
    rooms_in: rooms.join(', '),
    last_in: lastParts.join(' '),
    rooms,
    last_name_canonical: lastNameCanonical,
    stay_id
  };
}

// ---------- Handler ----------
async function fetchJson(url, opts={}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, json: JSON.parse(text), text }; }
  catch { return { ok: r.ok, status: r.status, json: null, text }; }
}

function pad(n){return n<10?'0'+n:''+n}
function fmtDate(d, fmt){return fmt.replace('%m',pad(d.getMonth()+1)).replace('%d',pad(d.getDate())).replace('%Y',d.getFullYear())}
function resolveTemplateDates(urlStr){
  try{
    const now=new Date();
    const tmr=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1));
    return urlStr.replace(/{start:%([^}]+)}/g,lambda=lambda m,fmt:fmtDate(tmr,'%'+fmt)).replace(/{end:%([^}]+)}/g,lambda=lambda m,fmt:fmtDate(tmr,'%'+fmt));
  }catch(e){return urlStr}
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Accept-Profile, Content-Profile');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Parse URL and normalize trailing slash
  let url;
  try { url = new URL(req.url, 'https://x'); }
  catch { res.status(400).send('Bad URL'); return; }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';

  try {
    // Health
    if (req.method === 'GET' && url.pathname === '/') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send('OK: coco-passport-proxy');
      return;
    }

    // ---------- /resolve ----------
    if (req.method === 'GET' && url.pathname === '/resolve') {
      const q = url.searchParams.get('stay_id') || '';
      const out = normalizeStayIdFreeform(q);
      res.status(200).json(out);
      return;
    }

    // ---------- /upload (binary) ----------
    if (req.method === 'POST' && url.pathname === '/upload') {
      const stay_id = url.searchParams.get('stay_id');
      const filename = (url.searchParams.get('filename') || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g, '_');
      if (!stay_id) { res.status(400).json({ ok: false, error: 'stay_id required' }); return; }

      // Slurp body bytes
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on('data', c => chunks.push(c));
        req.on('end', resolve);
        req.on('error', reject);
      });
      const buf = Buffer.concat(chunks);

      const objectPath = `passports/${stay_id}/${filename}`;
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: buf
      });
      if (!put.ok) {
        const t = await put.text();
        res.status(put.status).json({ ok: false, error: 'storage upload failed', body: t });
        return;
      }
      res.status(200).json({ ok: true, object_path: objectPath });
      return;
    }

    // ---------- /upload-url (fetch image from URL then store) ----------
    if (req.method === 'POST' && url.pathname === '/upload-url') {
      const body = await parseBody(req);
      const stay_id = body.stay_id;
      const imgUrl = body.url;
      const filename = (body.filename || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g, '_');
      if (!stay_id || !imgUrl) { res.status(400).json({ ok: false, error: 'stay_id and url required' }); return; }

      const fetchRes = await fetch(imgUrl);
      if (!fetchRes.ok) {
        const t = await fetchRes.text();
        res.status(400).json({ ok: false, error: `fetch image failed: ${fetchRes.status}`, body: t });
        return;
      }
      const buf = Buffer.from(await fetchRes.arrayBuffer());

      const objectPath = `passports/${stay_id}/${filename}`;
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: buf
      });
      if (!put.ok) {
        const t = await put.text();
        res.status(put.status).json({ ok: false, error: 'storage upload failed', body: t });
        return;
      }
      res.status(200).json({ ok: true, object_path: objectPath });
      return;
    }

    // ---------- /insert ----------
    if (req.method === 'POST' && url.pathname === '/insert') {
      const via = (url.searchParams.get('via') || '').toLowerCase(); // '' or 'table'
      const body = await parseBody(req);
      if (!body || !Array.isArray(body.rows)) {
        res.status(400).json({ ok: false, error: 'rows (array) required' });
        return;
      }

      // Prefer RPC
      if (via !== 'table') {
        const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify(body)
        });
        if (rpc.ok) {
          const txt = await rpc.text();
          // Supabase RPC returns '' or '[]'
          res.status(200).send(txt || '[]');
          return;
        }
        // Fall back to table insert if RPC failed
      }

      // Table fallback — insert one-by-one to report duplicates cleanly
      let inserted = 0;
      const skipped = [];
      for (const row of body.rows) {
        const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
          method: 'POST',
          headers: { ...baseHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify([row])
        });
        if (tbl.ok) {
          inserted += 1;
        } else {
          const errText = await tbl.text();
          // detect duplicate by 23505
          if (/23505/.test(errText)) {
            skipped.push({ passport_number: row.passport_number, reason: 'duplicate', raw: errText });
          } else {
            return res.status(tbl.status).json({ ok: false, status: tbl.status, error: errText, via: 'table' });
          }
        }
      }
      res.status(200).json({ ok: true, via: 'table', inserted, skipped });
      return;
    }

    // ---------- /export ----------
    if (req.method === 'GET' && url.pathname === '/export') {
      const stay_id = url.searchParams.get('stay_id');
      const rooms = url.searchParams.get('rooms');
      const last = url.searchParams.get('last');

      let q = `${SUPABASE_URL}/rest/v1/incoming_guests_export_view?order=created_at.asc&select=${encodeURIComponent('"First Name","Middle Name","Last Name","Gender","Passport Number","Nationality","Birthday"')}`;
      if (stay_id) {
        q += `&stay_id=eq.${encodeURIComponent(stay_id)}`;
      } else if (rooms && last) {
        const norm = normalizeStayIdFreeform(`${rooms} ${last}`).stay_id;
        if (!norm) { res.status(400).send('Bad rooms/last'); return; }
        q += `&stay_id=eq.${encodeURIComponent(norm)}`;
      } else {
        res.status(400).send('stay_id or (rooms+last) required'); return;
      }

      const r = await fetch(q, { headers: { ...baseHeaders, 'Accept': 'application/json' } });
      if (!r.ok) { const t = await r.text(); res.status(r.status).send(t || 'export error'); return; }
      const rows = await r.json();

      // Build tab-delimited text
      const header = ['First Name','Middle Name','Last Name','Gender','Passport Number','Nationality','Birthday'].join('\t');
      const lines = [header];
      for (const rec of rows) {
        lines.push([
          rec['First Name'] ?? '',
          rec['Middle Name'] ?? '',
          rec['Last Name'] ?? '',
          rec['Gender'] ?? '',
          rec['Passport Number'] ?? '',
          rec['Nationality'] ?? '',
          rec['Birthday'] ?? ''
        ].join('\t'));
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(lines.join('\n'));
      return;
    }

    // ---------- /status ----------
    if (req.method === 'GET' && url.pathname === '/status') {
      const stay_id = url.searchParams.get('stay_id');
      if (!stay_id) { res.status(400).send('stay_id required'); return; }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?stay_id=eq.${encodeURIComponent(stay_id)}&limit=1`, {
        headers: baseHeaders
      });
      if (!r.ok) { const t = await r.text(); res.status(r.status).send(t || 'status error'); return; }
      const rows = await r.json();
      const row = rows[0];
      let line = '0 of ? passports received 📸';
      if (row && typeof row.passports_received !== 'undefined' && typeof row.total_guests !== 'undefined') {
        if (row.passports_received >= row.total_guests && row.total_guests > 0) {
          line = '✅ All received';
        } else {
          line = `${row.passports_received} of ${row.total_guests} passports received 📸`;
        }
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(line);
      return;
    }

    // ---------- /recent ----------
    if (req.method === 'GET' && url.pathname === '/recent') {
      const limit = Math.max(1, Math.min(50, parseInt(url.searchParams.get('limit') || '10', 10)));
      const q = `${SUPABASE_URL}/rest/v1/incoming_guests_recent?select=stay_id,first_name,last_name,passport_number,created_at&order=created_at.desc&limit=${limit}`;
      const r = await fetch(q, { headers: baseHeaders });
      if (!r.ok) { const t = await r.text(); res.status(r.status).send(t || 'recent error'); return; }
      const rows = await r.json();
      res.status(200).json(rows);
      return;
    }

    // Fallback
    res.status(404).json({ ok: false, error: 'Not Found' });
  } catch (e) {
    res.status(500).send(e.message || 'server error');
  }

  // --- Tokeet upsert: pull feed and pre-seed stays_preseed -------------------
  if (req.method === 'POST' && url.pathname === '/tokeet-upsert') {
    try {
      const body = await parseBody(req).catch(()=>({}));
      const feedUrl = body.feed_url || process.env.TOKEET_FEED_URL;
      if (!feedUrl) {
        res.status(400).json({ ok:false, error:'missing feed_url (body) or TOKEET_FEED_URL env' });
        return;
      }

      const feed = await fetchJson(feedUrl);
      if (!feed.ok) {
        res.status(feed.status || 500).json({ ok:false, error:'fetch feed failed', body: feed.text });
        return;
      }

      // Expect an array of bookings with rooms + check-in/out + expected guests
      const items = Array.isArray(feed.json) ? feed.json : (feed.json.items || []);
      const rows = [];
      for (const it of items) {
        const label = `${(it.rooms||'').toString()} ${(it.last||it.guest_last||'').toString()}`.trim();
        const r = await fetchJson(`${process.env.VERCEL_URL ? 'https://'+process.env.VERCEL_URL : ''}/resolve?stay_id=${encodeURIComponent(label)}`);
        const stay_id = (r.json && r.json.stay_id) ? r.json.stay_id : null;
        if (!stay_id) continue;
        rows.push({
          stay_id,
          rooms: Array.isArray(r.json.rooms) ? r.json.rooms : [],
          check_in: it.check_in || null,
          check_out: it.check_out || null,
          expected_guest_count: it.expected_guest_count ?? it.guests ?? null
        });
      }

      if (!rows.length) {
        res.status(200).json({ ok:true, upserted:0 });
        return;
      }

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
      if (!put.ok) {
        res.status(put.status).json({ ok:false, error:'upsert failed', body: txt });
        return;
      }

      res.status(200).json({ ok:true, upserted: rows.length });
      return;
    } catch (e) {
      res.status(500).json({ ok:false, error: e.message || 'tokeet-upsert error' });
      return;
    }
  }
};
