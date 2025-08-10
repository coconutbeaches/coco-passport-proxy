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

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, apikey, Accept-Profile, Content-Profile");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // URL + normalize trailing slash
  let url;
  try {
    url = new URL(req.url, "http://local");
  } catch (e) {
    res.status(400).send("Bad URL");
    return;
  }
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  // Health
  if (req.method === "GET" && url.pathname === "/") {
    res.status(200).send("OK: coco-passport-proxy");
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }

  const baseHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
  };

  // ---------- helpers ----------
  const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

  // Robust normalizer for rooms + last name -> canonical stay_id
  function normalizeStayIdFreeform(raw) {
    if (!raw) {
      return {
        input: "",
        rooms_in: "",
        last_in: "",
        rooms: [],
        last_name_canonical: "",
        stay_id: "",
      };
    }

    // Pre-clean: underscores -> space, strip common punctuation to spaces, collapse spaces
    let cleaned = String(raw)
      .replace(/_/g, " ")
      .replace(/[,\.;:|\\\/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const ROOM_ORDER = ["A3","A4","A5","A6","A7","A8","A9","B6","B7","B8","B9"];
    const TWO_WORD_ROOMS = ["double house","jungle house","beach house","new house"];

    const parts = cleaned.split(/\s+/).filter(Boolean);
    const used = new Array(parts.length).fill(false);
    let rooms = [];

    // First pass: two-word rooms (case-insensitive)
    for (let i = 0; i < parts.length - 1; i++) {
      if (used[i] || used[i + 1]) continue;
      const two = (parts[i] + " " + parts[i + 1]).toLowerCase();
      if (TWO_WORD_ROOMS.includes(two)) {
        rooms.push(two.split(" ").map(cap1).join(" "));
        used[i] = true;
        used[i + 1] = true;
        i++;
      }
    }

    // Second pass: single-token rooms like A3..A9, B6..B9
    for (let i = 0; i < parts.length; i++) {
      if (used[i]) continue;
      const t = parts[i].toLowerCase();
      if (/^[ab][0-9]+$/.test(t)) {
        const canon = t.toUpperCase();
        if (ROOM_ORDER.includes(canon)) {
          rooms.push(canon);
          used[i] = true;
        }
      }
    }

    // Remaining tokens become last name parts
    const lastParts = parts.filter((_, i) => !used[i]);

    // TitleCase each part, then glue (remove spaces/hyphens)
    let lastNameCanonical = lastParts.map(cap1).join("");
    lastNameCanonical = lastNameCanonical.replace(/[\s-]+/g, "");

    // De-dup rooms and sort in canonical order
    rooms = Array.from(new Set(rooms));
    rooms.sort((a, b) => ROOM_ORDER.indexOf(a) - ROOM_ORDER.indexOf(b));

    const stay_id = [...rooms, lastNameCanonical].filter(Boolean).join("_");

    return {
      input: String(raw),
      rooms_in: rooms.join(", "),
      last_in: lastParts.join(" "),
      rooms,
      last_name_canonical: lastNameCanonical,
      stay_id,
    };
  }

  // ---------- /resolve ----------
  if (req.method === "GET" && url.pathname === "/resolve") {
    try {
      const raw = url.searchParams.get("stay_id") || "";
      const result = normalizeStayIdFreeform(raw);
      res.status(200).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "resolve failed" });
    }
    return;
  }

  // ---------- /upload (binary) ----------
  if (req.method === "POST" && url.pathname === "/upload") {
    try {
      const stay_id = url.searchParams.get("stay_id");
      const filename = (url.searchParams.get("filename") || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g, "_");
      if (!stay_id) {
        res.status(400).json({ ok: false, error: "stay_id required" });
        return;
      }
      const objectPath = `passports/${stay_id}/${filename}`;

      // read raw body
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", async () => {
        const buf = Buffer.concat(chunks);

        const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/octet-stream",
            "x-upsert": "true",
          },
          body: buf,
        });
        if (!put.ok) {
          const t = await put.text();
          res.status(put.status).json({ ok: false, error: "storage upload failed", body: t });
          return;
        }
        res.status(200).json({ ok: true, object_path: objectPath });
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "upload error" });
    }
    return;
  }

  // ---------- /upload-url (server fetch) ----------
  if (req.method === "POST" && url.pathname === "/upload-url") {
    try {
      const { stay_id, url: imgUrl, filename } = await parseBody(req);
      if (!stay_id || !imgUrl) {
        res.status(400).json({ ok: false, error: "stay_id and url required" });
        return;
      }
      const safeName = (filename || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g, "_");
      const objectPath = `passports/${stay_id}/${safeName}`;

      const fetchRes = await fetch(imgUrl);
      if (!fetchRes.ok) {
        const t = await fetchRes.text();
        res.status(400).json({ ok: false, error: `fetch image failed: ${fetchRes.status}`, body: t });
        return;
      }
      const buf = Buffer.from(await fetchRes.arrayBuffer());

      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/octet-stream",
          "x-upsert": "true",
        },
        body: buf,
      });
      if (!put.ok) {
        const t = await put.text();
        res.status(put.status).json({ ok: false, error: "storage upload failed", body: t });
        return;
      }
      res.status(200).json({ ok: true, object_path: objectPath });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "upload-url error" });
    }
    return;
  }

  // ---------- /insert ----------
  if (req.method === "POST" && url.pathname === "/insert") {
    try {
      const viaTable = url.searchParams.get("via") === "table";
      const body = await parseBody(req);

      if (!body || !Array.isArray(body.rows)) {
        res.status(400).json({ ok: false, error: "rows (array) required" });
        return;
      }

      // try RPC first unless forced to table
      if (!viaTable) {
        const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify(body),
        });
        if (rpc.ok) {
          const text = await rpc.text();
          res.status(200).send(text || "[]");
          return;
        }
        // fall through to table if RPC failed
      }

      // fallback: direct table insert (bulk)
      const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
        method: "POST",
        headers: { ...baseHeaders, Prefer: "return=minimal" },
        body: JSON.stringify(body.rows || []),
      });

      if (tbl.ok) {
        // we’ll check duplicates one-by-one to report a mini summary
        let inserted = 0;
        const skipped = [];
        for (const r of body.rows) {
          const single = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
            method: "POST",
            headers: { ...baseHeaders, Prefer: "resolution=merge-duplicates" },
            body: JSON.stringify([r]),
          });
          if (single.ok) {
            inserted += 1;
          } else {
            const raw = await single.text();
            // If duplicate key, report it
            skipped.push({
              passport_number: r.passport_number,
              reason: raw.includes("duplicate") || raw.includes("already exists") ? "duplicate" : "error",
              raw,
            });
          }
        }
        res.status(200).json({ ok: true, via: "table", inserted, skipped });
        return;
      } else {
        let err = await tbl.text();
        res.status(404).json({ ok: false, status: tbl.status, error: err ? JSON.parseSafe(err) ?? err : {}, via: "table" });
        return;
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "insert error" });
    }
    return;
  }

  // ---------- /export (tab-delimited with header) ----------
  if (req.method === "GET" && url.pathname === "/export") {
    try {
      const stay_id = url.searchParams.get("stay_id");
      const rooms = url.searchParams.get("rooms");
      const last = url.searchParams.get("last");

      let resolved = stay_id;
      if (!resolved && (rooms || last)) {
        const guess = normalizeStayIdFreeform(`${rooms || ""} ${last || ""}`);
        resolved = guess.stay_id;
      }

      if (!resolved) {
        res.status(400).send("First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday");
        return;
      }

      const q = new URLSearchParams({
        stay_id: `eq.${resolved}`,
        order: "created_at.asc",
        select: "\"First Name\",\"Middle Name\",\"Last Name\",\"Gender\",\"Passport Number\",\"Nationality\",\"Birthday\"",
      });

      const r = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests_export_view?${q}`, {
        headers: { ...baseHeaders, "Content-Type": "text/plain" },
      });
      if (!r.ok) {
        const t = await r.text();
        res.status(r.status).send(t || "Export error");
        return;
      }
      const rows = await r.json();

      const header = "First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday";
      const body = rows
        .map((x) =>
          [
            x["First Name"] ?? "",
            x["Middle Name"] ?? "",
            x["Last Name"] ?? "",
            x["Gender"] ?? "",
            x["Passport Number"] ?? "",
            x["Nationality"] ?? "",
            x["Birthday"] ?? "",
          ].join("\t")
        )
        .join("\n");

      res.status(200).type("text/plain").send(body ? `${header}\n${body}` : header);
    } catch (e) {
      res.status(500).type("text/plain").send(e.message || "export error");
    }
    return;
  }

  // ---------- /status (plain line) ----------
  if (req.method === "GET" && url.pathname === "/status") {
    try {
      const stay_id = url.searchParams.get("stay_id");
      if (!stay_id) {
        res.status(200).type("text/plain").send("0 of ? passports received 📸");
        return;
      }
      const q = new URLSearchParams({ stay_id: `eq.${stay_id}`, limit: "1" });
      const r = await fetch(`${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?${q}`, { headers: baseHeaders });
      if (!r.ok) {
        const t = await r.text();
        res.status(r.status).type("text/plain").send(t || "status error");
        return;
      }
      const [row] = await r.json();
      if (!row) {
        res.status(200).type("text/plain").send("0 of ? passports received 📸");
        return;
      }
      const { passports_received, total_guests } = row;
      const line =
        total_guests && passports_received >= total_guests
          ? "✅ All received"
          : `${passports_received || 0} of ${total_guests || "?"} passports received 📸`;
      res.status(200).type("text/plain").send(line);
    } catch (e) {
      res.status(500).type("text/plain").send(e.message || "status error");
    }
    return;
  }

  // Fallback
  res.status(404).json({ ok: false, error: "Not found" });
};

// little helper to safely JSON.parse in error paths
JSON.parseSafe = (s) => {
  try { return JSON.parse(s); } catch { return null; }
};
