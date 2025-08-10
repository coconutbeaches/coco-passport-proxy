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
  // CORS / preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, apikey, Accept-Profile, Content-Profile"
    );
    res.status(204).end();
    return;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, apikey, Accept-Profile, Content-Profile"
  );

  let url;
  try {
    url = new URL(req.url, "http://x");
  } catch (_) {
    res.status(400).send("Bad URL");
    return;
  }
  // normalize trailing slash
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  // health
  if (req.method === "GET" && url.pathname === "/") {
    res.status(200).send("OK: coco-passport-proxy");
    return;
  }

  const baseHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
  };

  // ====== UPLOAD (binary) ====================================================
  if (req.method === "POST" && url.pathname === "/upload") {
    try {
      const stay_id = url.searchParams.get("stay_id");
      const filename = (url.searchParams.get("filename") || `${crypto.randomUUID()}.jpg`)
        .replace(/[^A-Za-z0-9._-]/g, "_");
      if (!stay_id) {
        res.status(400).json({ ok: false, error: "stay_id required" });
        return;
      }
      const objectPath = `passports/${stay_id}/${filename}`;

      // read raw body
      const chunks = [];
      await new Promise((resolve, reject) => {
        req.on("data", (c) => chunks.push(c));
        req.on("end", resolve);
        req.on("error", reject);
      });
      const buf = Buffer.concat(chunks);

      // storage upload (POST + x-upsert)
      const put = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/octet-stream",
            "x-upsert": "true",
          },
          body: buf,
        }
      );
      if (!put.ok) {
        const t = await put.text();
        res.status(put.status).json({ ok: false, error: "storage upload failed", body: t });
        return;
      }
      res.status(200).json({ ok: true, object_path: objectPath });
      return;
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "upload error" });
      return;
    }
  }

  // ====== UPLOAD from URL ====================================================
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

      const put = await fetch(
        `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`,
        {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/octet-stream",
            "x-upsert": "true",
          },
          body: buf,
        }
      );
      if (!put.ok) {
        const t = await put.text();
        res.status(put.status).json({ ok: false, error: "storage upload failed", body: t });
        return;
      }
      res.status(200).json({ ok: true, object_path: objectPath });
      return;
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "upload-url error" });
      return;
    }
  }

  // ====== INSERT (auto-fallback; no need for ?via=table) =====================
  if (req.method === "POST" && url.pathname === "/insert") {
    try {
      const body = await parseBody(req);
      let rows = Array.isArray(body) ? body : body.rows;
      if (!rows || !Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ ok: false, error: "rows (array) required" });
        return;
      }

      // Normalize rows (fix common typos and shapes)
      rows = rows.map((r) => {
        const copy = { ...r };
        // nationality_alpha_3 -> nationality_alpha3
        if (copy.nationality_alpha_3 && !copy.nationality_alpha3) {
          copy.nationality_alpha3 = copy.nationality_alpha_3;
          delete copy.nationality_alpha_3;
        }
        // coerce photo_urls to array
        if (typeof copy.photo_urls === "string") copy.photo_urls = [copy.photo_urls];
        if (!Array.isArray(copy.photo_urls)) copy.photo_urls = [];
        // empty middle_name -> "" (keep consistent)
        if (copy.middle_name == null) copy.middle_name = "";
        // gender "" allowed
        return copy;
      });

      // First try RPC
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ rows }),
      });

      if (rpcRes.ok) {
        const text = await rpcRes.text();
        // Supabase RPC often returns "[]" on success
        res.status(200).send(text || "[]");
        return;
      }

      // If RPC isn’t available, fall back to direct table insert
      const tblRes = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
        method: "POST",
        headers: { ...baseHeaders, Prefer: "return=minimal" },
        body: JSON.stringify(rows),
      });

      if (tblRes.ok) {
        res.status(200).json({ ok: true, via: "table" });
        return;
      }

      // If duplicate (409), treat as soft-success so we can still export/status
      if (tblRes.status === 409) {
        const err = await tblRes.text();
        res.status(200).json({ ok: true, via: "table-dup", warning: "duplicate", error: err });
        return;
      }

      const errTxt = await tblRes.text();
      res.status(tblRes.status || 500).json({ ok: false, status: tblRes.status, error: errTxt, via: "table" });
      return;
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "insert error" });
      return;
    }
  }

  // ====== EXPORT (tab-delimited; plain text) =================================
  if (req.method === "GET" && url.pathname === "/export") {
    const stay_id = url.searchParams.get("stay_id");
    const rooms = url.searchParams.get("rooms");
    const last = url.searchParams.get("last");
    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Accept-Profile": "public",
    };

    try {
      let q = "";
      if (stay_id) {
        q = `stay_id=eq.${encodeURIComponent(stay_id)}&order=created_at.asc&select=${encodeURIComponent('"First Name","Middle Name","Last Name","Gender","Passport Number","Nationality","Birthday"')}`;
      } else if (rooms && last) {
        q = `rooms=${encodeURIComponent(rooms)}&last=${encodeURIComponent(last)}&select=${encodeURIComponent('"First Name","Middle Name","Last Name","Gender","Passport Number","Nationality","Birthday"')}`;
      } else {
        res.status(400).send('Missing stay_id or (rooms+last)');
        return;
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests_export_view?${q}`, {
        method: "GET",
        headers,
      });
      if (!r.ok) {
        const t = await r.text();
        res.status(r.status).send(t || "export error");
        return;
      }
      const json = await r.json();

      let out = "First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday";
      for (const row of json) {
        out += `\n${row["First Name"] ?? ""}\t${row["Middle Name"] ?? ""}\t${row["Last Name"] ?? ""}\t${row["Gender"] ?? ""}\t${row["Passport Number"] ?? ""}\t${row["Nationality"] ?? ""}\t${row["Birthday"] ?? ""}`;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(200).send(out);
      return;
    } catch (e) {
      res.status(500).send(e.message || "export exception");
      return;
    }
  }

  // ====== STATUS (plain text) ================================================
  if (req.method === "GET" && url.pathname === "/status") {
    const stay_id = url.searchParams.get("stay_id");
    if (!stay_id) {
      res.status(400).send("Missing stay_id");
      return;
    }
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?stay_id=eq.${encodeURIComponent(stay_id)}&limit=1`,
        {
          method: "GET",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Accept-Profile": "public",
          },
        }
      );
      if (!r.ok) {
        const t = await r.text();
        res.status(r.status).send(t || "status error");
        return;
      }
      const [row] = await r.json();
      let line = "0 of ? passports received 📸";
      if (row) {
        line = row.status || `${row.passports_received || 0} of ${row.total_guests || "?"} passports received 📸`;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.status(200).send(line);
      return;
    } catch (e) {
      res.status(500).send(e.message || "status exception");
      return;
    }
  }

  // default 404
  res.status(404).send("Not Found");
};
