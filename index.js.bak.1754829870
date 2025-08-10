const crypto = require("crypto");

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    try {
      if (req.method === "GET" || req.method === "HEAD") return resolve({});
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
      req.on("error", reject);
    } catch (e) {
      reject(e);
    }
  });

module.exports = async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, apikey, Accept-Profile, Content-Profile"
  );
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // Parse URL safely
  let url;
  try {
    url = new URL(req.url, "https://x/");
  } catch {
    res.status(400).send("Bad URL");
    return;
  }
  // normalize trailing slash
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";

  // Health
  if (req.method === "GET" && url.pathname === "/") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.status(200).send("OK: coco-passport-proxy");
    return;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res
      .status(500)
      .json({ ok: false, error: "Missing SUPABASE_URL or SERVICE_ROLE key" });
    return;
  }

  const baseHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    "Accept-Profile": "public",
    "Content-Profile": "public",
  };

  // ---------- UPLOAD (binary) ----------
  if (req.method === "POST" && url.pathname === "/upload") {
    try {
      const stay_id = url.searchParams.get("stay_id");
      const filename = (url.searchParams.get("filename") || `${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g, "_");
      if (!stay_id) {
        res.status(400).json({ ok: false, error: "stay_id required" });
        return;
      }
      const objectPath = `passports/${stay_id}/${filename}`;

      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", async () => {
        const buf = Buffer.concat(chunks);
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
          res
            .status(put.status)
            .json({ ok: false, error: "storage upload failed", body: t });
          return;
        }
        res.status(200).json({ ok: true, object_path: objectPath });
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "upload error" });
    }
    return;
  }

  // ---------- UPLOAD from URL ----------
  if (req.method === "POST" && url.pathname === "/upload-url") {
    try {
      const { stay_id, url: imgUrl, filename } = await parseBody(req);
      if (!stay_id || !imgUrl) {
        res.status(400).json({ ok: false, error: "stay_id and url required" });
        return;
      }
      const safeName = (filename || `${crypto.randomUUID()}.jpg`).replace(
        /[^A-Za-z0-9._-]/g,
        "_"
      );
      const objectPath = `passports/${stay_id}/${safeName}`;

      const fetchRes = await fetch(imgUrl);
      if (!fetchRes.ok) {
        const t = await fetchRes.text();
        res
          .status(400)
          .json({ ok: false, error: `fetch image failed: ${fetchRes.status}`, body: t });
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
        res
          .status(put.status)
          .json({ ok: false, error: "storage upload failed", body: t });
        return;
      }
      res.status(200).json({ ok: true, object_path: objectPath });
      return;
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "upload-url error" });
      return;
    }
  }

  // ---------- INSERT (RPC first by default; ?via=table for richer report) ----------
  if (req.method === "POST" && url.pathname === "/insert") {
    try {
      const qVia = url.searchParams.get("via");
      const body = await parseBody(req);
      const rows = Array.isArray(body?.rows) ? body.rows : null;
      if (!rows || rows.length === 0) {
        res.status(400).json({ ok: false, error: "rows (array) required" });
        return;
      }

      // Rich report path: via=table (per-row POST to capture inserted vs duplicates)
      if (qVia === "table") {
        const inserted = [];
        const skipped = [];
        for (const r of rows) {
          const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
            method: "POST",
            headers: {
              ...baseHeaders,
              Prefer: "return=representation",
            },
            body: JSON.stringify([r]),
          });
          if (tbl.ok) {
            const js = await tbl.json().catch(() => []);
            if (Array.isArray(js) && js.length) {
              inserted.push(js[0]);
            } else {
              inserted.push(r); // fallback record
            }
          } else {
            // try to read error; classify duplicates
            const text = await tbl.text();
            const dup =
              text.includes("duplicate key value") ||
              text.includes("already exists") ||
              tbl.status === 409;
            skipped.push({
              passport_number: r.passport_number,
              reason: dup ? "duplicate" : `error ${tbl.status}`,
              raw: text.slice(0, 400),
            });
          }
        }
        res.status(200).json({
          ok: true,
          via: "table",
          inserted: inserted.length,
          skipped,
        });
        return;
      }

      // Default path: try RPC; if not OK, fall back to simple table bulk (minimal)
      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify({ rows }),
      });

      if (!rpc.ok) {
        // fallback bulk (no per-row insight)
        const tbl = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
          method: "POST",
          headers: { ...baseHeaders, Prefer: "return=minimal" },
          body: JSON.stringify(rows),
        });
        if (!tbl.ok) {
          const err = await tbl.text();
          res.status(tbl.status).json({
            ok: false,
            status: tbl.status,
            error: err || "Insert failed",
            via: "table",
          });
          return;
        }
        res.status(200).json({ ok: true, via: "table" });
        return;
      }

      const text = await rpc.text();
      res.status(200).send(text || "[]");
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "insert error" });
    }
    return;
  }

  // ---------- EXPORT (tab-delimited; plain text) ----------
  if (req.method === "GET" && url.pathname === "/export") {
    try {
      const stay_id = url.searchParams.get("stay_id");
      const rooms = url.searchParams.get("rooms"); // optional helper
      const last = url.searchParams.get("last"); // optional helper

      res.setHeader("Content-Type", "text/plain; charset=utf-8");

      let qs = "";
      if (stay_id) {
        qs = `?stay_id=eq.${encodeURIComponent(stay_id)}&order=created_at.asc&select=${encodeURIComponent('"First Name","Middle Name","Last Name","Gender","Passport Number","Nationality","Birthday"')}`;
      } else if (rooms && last) {
        const cleanedLast = last.trim().replace(/\s+/g, " ");
        qs = `?rooms=${encodeURIComponent(rooms)}&last=${encodeURIComponent(cleanedLast)}&select=${encodeURIComponent('"First Name","Middle Name","Last Name","Gender","Passport Number","Nationality","Birthday"')}`;
      } else {
        res.status(400).send("Missing stay_id or rooms+last");
        return;
      }

      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/incoming_guests_export_view${qs}`,
        { headers: { ...baseHeaders, "Content-Type": "application/json" } }
      );
      if (!r.ok) {
        const t = await r.text();
        res.status(r.status).send(t || "export error");
        return;
      }
      const arr = await r.json();
      let out = "First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday";
      for (const row of arr) {
        out +=
          "\n" +
          [
            row["First Name"] ?? "",
            row["Middle Name"] ?? "",
            row["Last Name"] ?? "",
            row["Gender"] ?? "",
            row["Passport Number"] ?? "",
            row["Nationality"] ?? "",
            row["Birthday"] ?? "",
          ].join("\t");
      }
      res.status(200).send(out);
    } catch (e) {
      res.status(500).send(e.message || "export error");
    }
    return;
  }

  // ---------- STATUS (plain text) ----------
  if (req.method === "GET" && url.pathname === "/status") {
    try {
      const stay_id = url.searchParams.get("stay_id");
      if (!stay_id) {
        res.status(400).send("Missing stay_id");
        return;
      }
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?stay_id=eq.${encodeURIComponent(
          stay_id
        )}`,
        { headers: baseHeaders }
      );
      if (!r.ok) {
        const t = await r.text();
        res.status(r.status).send(t || "status error");
        return;
      }
      const js = await r.json();
      const row = Array.isArray(js) && js[0] ? js[0] : null;
      if (!row) {
        res.status(200).send("0 of ? passports received 📸");
        return;
      }
      if (row.status && row.status.includes("✅")) {
        res.status(200).send("✅ All received");
        return;
      }
      const got = row.passports_received ?? 0;
      const tot = row.total_guests ?? "?";
      res.status(200).send(`${got} of ${tot} passports received 📸`);
    } catch (e) {
      res.status(500).send(e.message || "status error");
    }
    return;
  }

  // ---------- RECENT (JSON list) ----------
  if (req.method === "GET" && url.pathname === "/recent") {
    try {
      const lim = Math.max(1, Math.min(50, parseInt(url.searchParams.get("limit") || "5", 10)));
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/recent_incoming_guests?limit=${lim}`,
        { headers: baseHeaders }
      );
      const text = await r.text();
      res.status(r.ok ? 200 : r.status).send(text);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message || "recent error" });
    }
    return;
  }

  // Fallback 404
  res.status(404).send("Not found");
};
// force build Sun Aug 10 19:28:30 +07 2025
