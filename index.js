const crypto = require("crypto");

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });

const send = (res, code, payload, type = "application/json") => {
  res.statusCode = code;
  res.setHeader("Content-Type", type);
  if (type === "application/json") {
    res.end(JSON.stringify(payload));
  } else {
    res.end(payload);
  }
};

const OK = (res, text = "OK: coco-passport-proxy") => send(res, 200, text, "text/plain; charset=utf-8");

const normalizePathname = (url) => {
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.pathname;
};

/* -------------------------
   /resolve helpers
--------------------------*/
const ROOM_CANON = [
  "A3","A4","A5","A6","A7","A8","A9",
  "B6","B7","B8","B9",
  "Double_House","Jungle_House","Beach_House","New_House"
];

const ROOM_VARIANTS = [
  ["A3"],["A4"],["A5"],["A6"],["A7"],["A8"],["A9"],
  ["B6"],["B7"],["B8"],["B9"],
  ["Double_House","Double House","doublehouse","double-house","double  house"],
  ["Jungle_House","Jungle House","junglehouse","jungle-house","jungle  house"],
  ["Beach_House","Beach House","beachhouse","beach-house","beach  house"],
  ["New_House","New House","newhouse","new-house","new  house"]
];

// map any variant -> canonical
const roomLookup = (() => {
  const map = new Map();
  for (const variants of ROOM_VARIANTS) {
    const canon = variants[0];
    for (const v of variants) {
      map.set(v.toLowerCase().replace(/\s+/g, " ").trim(), canon);
    }
  }
  // plain codes as well
  for (const r of ROOM_CANON) {
    map.set(r.toLowerCase(), r);
  }
  return map;
})();

const stripDiacritics = (s) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const titleCase = (s) =>
  s.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase());

const normalizeLastName = (raw) => {
  if (!raw) return "";
  // remove hyphens, collapse spaces, remove diacritics, title-case each chunk, then join chunks without spaces
  const noDia = stripDiacritics(raw);
  const cleaned = noDia.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(" ").map(titleCase);
  return parts.join(""); // VanDerMeer
};

const parseRooms = (raw) => {
  if (!raw) return [];
  // allow commas, spaces, extra punctuation
  const tokens = raw
    .split(/[,/|]+/).join(" ")
    .replace(/[^A-Za-z0-9_ ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const collected = new Set();

  // Try to re-join multiword rooms in the stream (e.g., "Double", "House")
  for (let i = 0; i < tokens.length; i++) {
    const single = tokens[i];
    const two = (tokens[i] + " " + (tokens[i + 1] || "")).trim();
    const three = (tokens[i] + " " + (tokens[i + 1] || "") + " " + (tokens[i + 2] || "")).trim();

    const cand = [three, two, single];
    let matched = null;
    for (const c of cand) {
      const key = c.toLowerCase().replace(/\s+/g, " ").trim();
      if (roomLookup.has(key)) {
        matched = roomLookup.get(key);
        break;
      }
    }
    if (matched) {
      collected.add(matched);
      // skip extra tokens if we consumed 2 or 3
      if (matched.includes("_")) {
        // Double_House / Jungle_House / Beach_House / New_House — consume 2 words
        i += 1;
      }
    }
  }

  // sort rooms in a stable, predictable order (A* then B*, then Houses)
  const orderIndex = new Map(ROOM_CANON.map((r, idx) => [r, idx]));
  return [...collected].sort((a, b) => orderIndex.get(a) - orderIndex.get(b));
};

const resolveStayId = ({ input, rooms, last }) => {
  // Strategy:
  // - if `rooms` present, use it; else try to extract from `input`
  // - if `last` present, use it; else take the remaining non-room words at the end of `input`
  // - normalize rooms to canon, normalize last name (remove diacritics; TitleCase; remove spaces)
  // - join rooms with '_' then '_' + last
  const base = (input || "").trim();

  let roomCanon = [];
  if (rooms && typeof rooms === "string") {
    roomCanon = parseRooms(rooms);
  } else if (Array.isArray(rooms)) {
    roomCanon = parseRooms(rooms.join(" "));
  } else {
    // extract rooms from input text
    roomCanon = parseRooms(base);
  }

  // Derive last name
  let lastRaw = last;
  if (!lastRaw) {
    // try to get whatever remains after removing any room-like tokens
    const lowered = base.toLowerCase();
    let scratch = " " + lowered + " ";
    for (const r of roomCanon) {
      const variants = ROOM_VARIANTS.find(vs => vs[0] === r) || [r];
      for (const v of variants) {
        const key = " " + v.toLowerCase().replace(/\s+/g, " ").trim() + " ";
        scratch = scratch.replace(key, " ");
      }
      // also remove plain code form (A3/A4/etc) if present
      scratch = scratch.replace((" " + r.toLowerCase() + " "), " ");
      scratch = scratch.replace((" " + r.toLowerCase().replace("_", " ") + " "), " ");
    }
    lastRaw = scratch.replace(/\s+/g, " ").trim();
  }

  const lastCanon = normalizeLastName(lastRaw || "");
  const roomsJoined = roomCanon.join("_");
  const stayId = roomsJoined && lastCanon ? `${roomsJoined}_${lastCanon}` : (roomsJoined || lastCanon || "");

  return {
    input: base,
    rooms_in: rooms,
    last_in: last,
    rooms: roomCanon,
    last_name_canonical: lastCanon,
    stay_id: stayId
  };
};

/* -------------------------
   Handler with routes
--------------------------*/
module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, Accept-Profile, Content-Profile");
  if (req.method === "OPTIONS") return OK(res);

  let url;
  try {
    url = new URL(req.url, "http://local");
  } catch {
    return send(res, 400, { ok: false, error: "bad url" });
  }
  const path = normalizePathname(url);

  // Root health
  if (req.method === "GET" && path === "/") return OK(res);

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return send(res, 500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
  }

  const baseHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public"
  };

  /* ---------------------------------
     /resolve  (GET or POST)
     - GET  /resolve?input=...  OR  /resolve?rooms=A8,B8&last=dupônt
     - POST { input?: string, rooms?: string|string[], last?: string }
  ----------------------------------*/
  if ((req.method === "GET" || req.method === "POST") && path === "/resolve") {
    try {
      let body = {};
      if (req.method === "POST") body = await parseBody(req);
      const input = (req.method === "GET" ? url.searchParams.get("input") : body.input) || "";
      const rooms = (req.method === "GET" ? url.searchParams.get("rooms") : body.rooms) || "";
      const last = (req.method === "GET" ? url.searchParams.get("last") : body.last) || "";
      const resolved = resolveStayId({ input, rooms, last });
      return send(res, 200, resolved);
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message || "resolve error" });
    }
  }

  /* ---------------------------------
     /upload  (binary)
     POST /upload?stay_id=...&filename=...
  ----------------------------------*/
  if (req.method === "POST" && path === "/upload") {
    const stay_id = url.searchParams.get("stay_id");
    const filename = (url.searchParams.get("filename") || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g, "_");
    if (!stay_id) return send(res, 400, { ok: false, error: "stay_id required" });

    const objectPath = `passports/${stay_id}/${filename}`;
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const buf = Buffer.concat(chunks);
        const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/octet-stream",
            "x-upsert": "true"
          },
          body: buf
        });
        if (!put.ok) {
          const t = await put.text();
          return send(res, put.status, { ok: false, error: "storage upload failed", body: t });
        }
        return send(res, 200, { ok: true, object_path: objectPath });
      } catch (e) {
        return send(res, 500, { ok: false, error: e.message || "upload error" });
      }
    });
    return;
  }

  /* ---------------------------------
     /upload-url  (JSON)
     POST { stay_id, url, filename? }
  ----------------------------------*/
  if (req.method === "POST" && path === "/upload-url") {
    try {
      const { stay_id, url: imgUrl, filename } = await parseBody(req);
      if (!stay_id || !imgUrl) return send(res, 400, { ok: false, error: "stay_id and url required" });

      const safeName = (filename || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g, "_");
      const objectPath = `passports/${stay_id}/${safeName}`;

      const fetchRes = await fetch(imgUrl);
      if (!fetchRes.ok) {
        const t = await fetchRes.text();
        return send(res, 400, { ok: false, error: `fetch image failed: ${fetchRes.status}`, body: t });
      }
      const buf = Buffer.from(await fetchRes.arrayBuffer());

      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/octet-stream",
          "x-upsert": "true"
        },
        body: buf
      });
      if (!put.ok) {
        const t = await put.text();
        return send(res, put.status, { ok: false, error: "storage upload failed", body: t });
      }
      return send(res, 200, { ok: true, object_path: objectPath });
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message || "upload-url error" });
    }
  }

  /* ---------------------------------
     /insert  (JSON)  { rows: [...] }
     - RPC first, fallback to direct table insert
  ----------------------------------*/
  if (req.method === "POST" && path === "/insert") {
    try {
      const body = await parseBody(req);
      if (!body || !Array.isArray(body.rows)) return send(res, 400, { ok: false, error: "rows (array) required" });

      // RPC first
      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(body)
      });

      if (!rpc.ok) {
        // fallback to table
        const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
          method: "POST",
          headers: { ...baseHeaders, Prefer: "return=representation" },
          body: JSON.stringify(body.rows || [])
        });

        if (!tbl.ok) {
          const err = await tbl.text();
          return send(res, tbl.status, { ok: false, status: tbl.status, error: err || "Insert failed", via: "table" });
        }

        // Count inserted; detect duplicates if any were silently skipped (unlikely with return=representation)
        const result = await tbl.json();
        return send(res, 200, { ok: true, via: "table", inserted: Array.isArray(result) ? result.length : undefined });
      }

      // RPC returns text/JSON (often [])
      const text = await rpc.text();
      if (!text) return send(res, 200, []);
      try {
        return send(res, 200, JSON.parse(text));
      } catch {
        return send(res, 200, text);
      }
    } catch (e) {
      return send(res, 500, { ok: false, error: e.message || "Unknown insert error" });
    }
  }

  /* ---------------------------------
     /export  (GET) -> text/plain (tab-delimited with header)
  ----------------------------------*/
  if (req.method === "GET" && path === "/export") {
    const stay_id = url.searchParams.get("stay_id");
    const rooms = url.searchParams.get("rooms");
    const last = url.searchParams.get("last");
    try {
      let targetStay = stay_id;
      if (!targetStay && (rooms || last)) {
        targetStay = resolveStayId({ rooms, last }).stay_id;
      }
      if (!targetStay) return send(res, 400, "First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday", "text/plain; charset=utf-8");

      const q = new URL(`${SUPABASE_URL}/rest/v1/incoming_guests_export_view`);
      q.searchParams.set("stay_id", `eq.${targetStay}`);
      q.searchParams.set("order", "created_at.asc");

      const r = await fetch(q.toString(), {
        headers: {
          ...baseHeaders,
          Accept: "text/csv"
        }
      });

      if (!r.ok) return send(res, r.status, "First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday", "text/plain; charset=utf-8");

      const arr = await r.json(); // supabase returns JSON rows, we’ll render as TSV
      const header = "First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday";
      const lines = [header];
      for (const row of arr) {
        lines.push([
          row["First Name"] ?? "",
          row["Middle Name"] ?? "",
          row["Last Name"] ?? "",
          row["Gender"] ?? "",
          row["Passport Number"] ?? "",
          row["Nationality"] ?? "",
          row["Birthday"] ?? ""
        ].join("\t"));
      }
      return send(res, 200, lines.join("\n"), "text/plain; charset=utf-8");
    } catch (e) {
      return send(res, 500, "First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday", "text/plain; charset=utf-8");
    }
  }

  /* ---------------------------------
     /status  (GET) -> text/plain (single line)
  ----------------------------------*/
  if (req.method === "GET" && path === "/status") {
    const stay_id = url.searchParams.get("stay_id");
    try {
      if (!stay_id) return send(res, 200, "0 of ? passports received 📸", "text/plain; charset=utf-8");
      const q = new URL(`${SUPABASE_URL}/rest/v1/v_passport_status_by_stay`);
      q.searchParams.set("stay_id", `eq.${stay_id}`);
      const r = await fetch(q.toString(), { headers: baseHeaders });
      if (!r.ok) return send(res, 200, "0 of ? passports received 📸", "text/plain; charset=utf-8");
      const js = await r.json();
      if (!Array.isArray(js) || js.length === 0) return send(res, 200, "0 of ? passports received 📸", "text/plain; charset=utf-8");
      const row = js[0];
      if (row.status && String(row.status).startsWith("✅")) return send(res, 200, "✅ All received", "text/plain; charset=utf-8");
      const x = row.passports_received ?? 0;
      const y = row.total_guests ?? "?";
      return send(res, 200, `${x} of ${y} passports received 📸`, "text/plain; charset=utf-8");
    } catch {
      return send(res, 200, "0 of ? passports received 📸", "text/plain; charset=utf-8");
    }
  }

  /* ---------------------------------
     /recent  (GET) -> last N inserts
  ----------------------------------*/
  if (req.method === "GET" && path === "/recent") {
    const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") || "5", 10)));
    const q = new URL(`${SUPABASE_URL}/rest/v1/incoming_guests`);
    q.searchParams.set("select", "stay_id,first_name,last_name,passport_number,created_at");
    q.searchParams.set("order", "created_at.desc");
    q.searchParams.set("limit", String(limit));
    const r = await fetch(q.toString(), { headers: baseHeaders });
    if (!r.ok) return send(res, r.status, []);
    const js = await r.json();
    return send(res, 200, js);
  }

  // Fallback
  return send(res, 404, { ok: false, error: "Not Found" });
};
