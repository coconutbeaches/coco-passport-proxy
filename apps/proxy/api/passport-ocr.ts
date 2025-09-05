import type { VercelRequest, VercelResponse } from "@vercel/node";

const OCR_URL = process.env.OCR_SERVICE_URL!;
const OCR_TOKEN = process.env.OCR_SERVICE_TOKEN!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  try {
    const headers: Record<string,string> = {};
    if (OCR_TOKEN) headers["Authorization"] = `Bearer ${OCR_TOKEN}`;
    const upstream = await fetch(OCR_URL, {
      method: "POST",
      headers,
      body: req as any,
      duplex: "half"
    });
    const contentType = upstream.headers.get("content-type") || "application/json";
    res.status(upstream.status)
       .setHeader("Content-Type", contentType)
       .send(await upstream.text());
  } catch (err:any) {
    res.status(500).json({ error: "OCR proxy failure", details: err.message });
  }
}
