// Classement Œufs & Pets — fonction serverless Vercel + Upstash Redis (REST)
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const KEY = "oeufspets:lb";
const TOP = 10;        // taille du classement affiché
const MAX_ROWS = 5000; // garde-fou anti-spam

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOK, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

async function allRows() {
  const a = (await redis(["HGETALL", KEY])) || [];
  const rows = [];
  for (let i = 0; i < a.length; i += 2) {
    try { rows.push({ id: a[i], ...JSON.parse(a[i + 1]) }); } catch (e) {}
  }
  return rows;
}

const clean = (s) => String(s == null ? "" : s).replace(/[<>&"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, 14);
const norm = (s) => s.toLowerCase();
const int = (v, lo, hi) => { v = Math.floor(Number(v)); return Number.isFinite(v) && v >= lo && v <= hi ? v : null; };
const idOk = (s) => typeof s === "string" && /^[a-z0-9]{6,40}$/i.test(s);

function body(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b && typeof b === "object" ? b : {};
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!URL_ || !TOK) return res.status(503).json({ error: "Base de données non connectée" });
  try {
    if (req.method === "GET") {
      const rows = await allRows();
      if (req.query && req.query.check !== undefined) {
        const name = clean(req.query.check);
        const id = String(req.query.id || "");
        return res.status(200).json({ taken: rows.some((r) => norm(r.name) === norm(name) && r.id !== id) });
      }
      rows.sort((a, b) => (b.bs - a.bs) || (b.b - a.b) || (b.s - a.s) || (b.n - a.n) || (a.t - b.t));
      const lim = Math.min(TOP, int(req.query && req.query.limit, 1, TOP) || TOP);
      return res.status(200).json(rows.slice(0, lim).map(({ name, n, s, b, bs }) => ({ name, n, s, b, bs })));
    }

    if (req.method === "POST") {
      const d = body(req);
      const name = clean(d.name);
      const n = int(d.n, 1, 100), s = int(d.s, 0, 100), b = int(d.b, 0, 99), bs = int(d.bs, 0, 1);
      if (!idOk(d.id) || name.length < 2 || n === null || s === null || b === null || bs === null || (bs === 1 && s < 1))
        return res.status(400).json({ error: "Données invalides" });
      const rows = await allRows();
      if (rows.some((r) => norm(r.name) === norm(name) && r.id !== d.id))
        return res.status(409).json({ error: "Pseudo déjà pris" });
      const mine = rows.find((r) => r.id === d.id);
      if (!mine && rows.length >= MAX_ROWS) return res.status(429).json({ error: "Classement plein" });
      await redis(["HSET", KEY, d.id, JSON.stringify({ name, n, s, b, bs, t: mine ? mine.t : Date.now() })]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === "DELETE") {
      const d = body(req);
      const id = d.id || (req.query && req.query.id);
      if (!idOk(id)) return res.status(400).json({ error: "id invalide" });
      await redis(["HDEL", KEY, id]);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Méthode non autorisée" });
  } catch (e) {
    return res.status(500).json({ error: "Erreur serveur" });
  }
};
