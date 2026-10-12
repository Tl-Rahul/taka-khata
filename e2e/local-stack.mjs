#!/usr/bin/env node
/**
 * Test-only stand-in for Supabase (Auth + PostgREST + Storage) on top of a real Postgres
 * that has supabase/test/supabase_stub.sql and the migrations applied.
 *
 * It runs every REST request inside a transaction as the `authenticated` (or `anon`) role with the
 * caller's JWT claims set — exactly how Supabase enforces Row Level Security — so end-to-end
 * tests exercise the real schema, triggers and RLS policies.
 *
 * Usage: DATABASE_URL=postgres://... JWT_SECRET=... node e2e/local-stack.mjs   (port 54321)
 * Not for production.
 */
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const PORT = Number(process.env.PORT || 54321);
const SECRET = process.env.JWT_SECRET || "local-test-secret-local-test-secret";
// return DATE as 'YYYY-MM-DD' strings like PostgREST does (node-pg would build JS Dates)
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1182, (v) => (v === "{}" ? [] : v.replace(/^\{|\}$/g, "").split(",")));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const storage = new Map(); // path -> {type, data}
const refreshTokens = new Map(); // token -> user id

// ---------------------------------------------------------------- JWT
const b64u = (b) => Buffer.from(b).toString("base64url");
export function sign(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verify(token) {
  const [h, p, s] = String(token || "").split(".");
  if (!s) return null;
  const want = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
const hashPw = (pw) => crypto.createHash("sha256").update(`pepper:${pw}`).digest("hex");

// ---------------------------------------------------------------- helpers
function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...cors, ...headers });
  res.end(body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body));
}
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-expose-headers": "content-range",
};
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}
function claimsFrom(req) {
  const auth = req.headers.authorization?.replace(/^Bearer /i, "");
  return verify(auth) ?? verify(req.headers.apikey) ?? { role: "anon" };
}
function userJson(u) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.created_at,
    phone: "",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: u.created_at,
    updated_at: u.created_at,
  };
}
function session(u) {
  const now = Math.floor(Date.now() / 1000);
  const access = sign({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 });
  const refresh = crypto.randomBytes(24).toString("hex");
  refreshTokens.set(refresh, u.id);
  return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u) };
}
function pgError(e) {
  const status = e.code === "23505" ? 409 : e.code === "42501" ? 403 : e.code === "P0002" ? 404 : 400;
  return [status, { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null }];
}
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { code: "42602" });
  return `"${s}"`;
};

// ---------------------------------------------------------------- auth
async function auth(req, res, url) {
  const route = url.pathname.replace("/auth/v1", "");
  const body = req.method === "GET" ? {} : JSON.parse((await readBody(req)).toString() || "{}");
  const db = await pool.connect();
  try {
    if (route === "/signup" && req.method === "POST") {
      if (!body.email || !body.password) return send(res, 400, { msg: "missing" });
      const ex = await db.query("select 1 from auth.users where email = $1", [body.email.toLowerCase()]);
      if (ex.rowCount) return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
      const { rows } = await db.query("insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, $2) returning *", [body.email.toLowerCase(), hashPw(body.password)]);
      return send(res, 200, session(rows[0]));
    }
    if (route === "/token") {
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const { rows } = await db.query("select * from auth.users where email = $1", [String(body.email).toLowerCase()]);
        if (!rows[0] || rows[0].encrypted_password !== hashPw(body.password)) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        return send(res, 200, session(rows[0]));
      }
      if (grant === "refresh_token") {
        const uid = refreshTokens.get(body.refresh_token);
        if (!uid) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        refreshTokens.delete(body.refresh_token);
        const { rows } = await db.query("select * from auth.users where id = $1", [uid]);
        return send(res, 200, session(rows[0]));
      }
    }
    const claims = verify(req.headers.authorization?.replace(/^Bearer /i, ""));
    if (route === "/user") {
      if (!claims?.sub) return send(res, 401, { code: 401, error_code: "no_authorization", msg: "invalid JWT" });
      if (req.method === "PUT" && body.password) await db.query("update auth.users set encrypted_password = $2 where id = $1", [claims.sub, hashPw(body.password)]);
      const { rows } = await db.query("select * from auth.users where id = $1", [claims.sub]);
      if (!rows[0]) return send(res, 403, { code: 403, error_code: "user_not_found", msg: "User not found" });
      return send(res, 200, userJson(rows[0]));
    }
    if (route === "/logout") return send(res, 204);
    if (route === "/recover") return send(res, 200, {});
    return send(res, 404, { msg: `not emulated: ${req.method} ${route}` });
  } finally {
    db.release();
  }
}

// ---------------------------------------------------------------- rest
function parseFilters(params) {
  const where = [];
  const values = [];
  for (const [k, v] of params) {
    if (["select", "order", "offset", "limit", "columns", "on_conflict"].includes(k)) continue;
    const m = /^(eq|neq|in|is|gt|gte|lt|lte)\.(.*)$/s.exec(v);
    if (!m) continue;
    const [, op, raw] = m;
    const col = ident(k);
    if (op === "in") {
      const items = raw.replace(/^\(|\)$/g, "").match(/("([^"]*)"|[^,]+)/g)?.map((s) => s.replace(/^"|"$/g, "")) ?? [];
      values.push(items);
      where.push(`${col}::text = any($${values.length}::text[])`);
    } else if (op === "is") {
      where.push(`${col} is ${raw === "null" ? "null" : raw === "true" ? "true" : "false"}`);
    } else {
      values.push(raw);
      const sym = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[op];
      where.push(`${col}::text ${sym} $${values.length}`);
    }
  }
  return { where: where.length ? `where ${where.join(" and ")}` : "", values };
}

async function rest(req, res, url) {
  const parts = url.pathname.replace("/rest/v1/", "").split("/");
  const claims = claimsFrom(req);
  const role = claims.role === "authenticated" ? "authenticated" : "anon";
  const db = await pool.connect();
  const wantsObject = (req.headers.accept || "").includes("vnd.pgrst.object");
  try {
    await db.query("begin");
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    let rows;
    if (parts[0] === "rpc") {
      const fn = ident(parts[1]);
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const keys = Object.keys(body);
      const args = keys.map((k, i) => `${ident(k)} := $${i + 1}::jsonb`).join(", ");
      const r = await db.query(`select to_jsonb(public.${fn}(${args})) as result`, keys.map((k) => JSON.stringify(body[k])));
      await db.query("commit");
      return send(res, 200, r.rows[0].result === null ? "" : r.rows[0].result);
    }
    const table = `public.${ident(parts[0])}`;
    const { where, values } = parseFilters(url.searchParams);
    if (req.method === "GET") {
      const order = (url.searchParams.get("order") || "")
        .split(",")
        .filter(Boolean)
        .map((o) => {
          const [c, dir] = o.split(".");
          return `${ident(c)} ${dir === "desc" ? "desc" : "asc"}`;
        });
      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      ({ rows } = await db.query(`select * from ${table} ${where} ${order.length ? `order by ${order.join(",")}` : ""} ${limit ? `limit ${Number(limit)}` : ""} ${offset ? `offset ${Number(offset)}` : ""}`, values));
    } else if (req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString());
      const arr = Array.isArray(body) ? body : [body];
      const cols = [...new Set(arr.flatMap((o) => Object.keys(o)))].map(ident);
      values.push(JSON.stringify(arr));
      const onConflict = url.searchParams.get("on_conflict");
      const ignoreDup = (req.headers.prefer || "").includes("resolution=ignore-duplicates") && onConflict;
      const conflict = ignoreDup ? ` on conflict (${onConflict.split(",").map(ident).join(",")}) do nothing` : "";
      ({ rows } = await db.query(`insert into ${table} (${cols.join(",")}) select ${cols.join(",")} from json_populate_recordset(null::${table}, $${values.length}::json)${conflict} returning *`, values));
    } else if (req.method === "PATCH") {
      const body = JSON.parse((await readBody(req)).toString());
      const cols = Object.keys(body).map(ident);
      values.push(JSON.stringify(body));
      ({ rows } = await db.query(`update ${table} set (${cols.join(",")}) = (select ${cols.join(",")} from json_populate_record(null::${table}, $${values.length}::json)) ${where} returning *`, values));
    } else if (req.method === "DELETE") {
      ({ rows } = await db.query(`delete from ${table} ${where} returning *`, values));
    }
    await db.query("commit");
    if (wantsObject) {
      if (rows.length !== 1) return send(res, 406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `${rows.length} rows`, hint: null });
      return send(res, 200, rows[0]);
    }
    const prefer = req.headers.prefer || "";
    if (req.method !== "GET" && !prefer.includes("return=representation")) return send(res, 204);
    return send(res, req.method === "POST" ? 201 : 200, rows);
  } catch (e) {
    await db.query("rollback").catch(() => {});
    if (process.env.DEBUG) console.error("REST ERROR", req.method, url.pathname, e.code, e.message);
    const [status, body] = pgError(e);
    return send(res, status, body);
  } finally {
    db.release();
  }
}

// ---------------------------------------------------------------- storage (receipts)
async function storageApi(req, res, url) {
  const claims = claimsFrom(req);
  const p = url.pathname.replace("/storage/v1/", "");
  const owns = (path) => claims.sub && path.split("/")[1] === claims.sub;
  if (req.method === "POST" && p.startsWith("object/sign/")) {
    const path = p.replace("object/sign/", "");
    if (!owns(path) || !storage.has(path)) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
    return send(res, 200, { signedURL: `/object/public/${path}` });
  }
  if (req.method === "GET" && p.startsWith("object/public/")) {
    const obj = storage.get(p.replace("object/public/", ""));
    if (!obj) return send(res, 404, {});
    res.writeHead(200, { "content-type": obj.type, ...cors });
    return res.end(obj.data);
  }
  if (req.method === "POST" && p.startsWith("object/")) {
    const path = p.replace("object/", "");
    if (!owns(path)) return send(res, 403, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    storage.set(path, { type: req.headers["content-type"], data: await readBody(req) });
    return send(res, 200, { Key: path, Id: crypto.randomUUID() });
  }
  if (req.method === "DELETE" && p.startsWith("object/")) {
    const body = JSON.parse((await readBody(req)).toString() || "{}");
    const bucket = p.replace("object/", "");
    for (const pref of body.prefixes ?? []) if (owns(`${bucket}/${pref}`)) storage.delete(`${bucket}/${pref}`);
    return send(res, 200, []);
  }
  return send(res, 404, { message: "not emulated" });
}

http
  .createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204);
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname.startsWith("/auth/v1")) return await auth(req, res, url);
      if (url.pathname.startsWith("/rest/v1")) return await rest(req, res, url);
      if (url.pathname.startsWith("/storage/v1")) return await storageApi(req, res, url);
      send(res, 404, { message: "not found" });
    } catch (e) {
      send(res, 500, { message: String(e?.message || e) });
    }
  })
  .listen(PORT, () => {
    const anon = sign({ role: "anon", iss: "local", iat: 1700000000, exp: 4000000000 });
    console.log(`local stack on http://localhost:${PORT}\nANON_KEY=${anon}`);
  });
