/**
 * Echowall admin API. Requires env.DB and the Cloudflare Secret `administrator`
 * (the administrator password). A session signing key is derived from it.
 * Legacy env.ECHOWALL_ADMIN_PASSWORD / ECHOWALL_ADMIN_SESSION_SECRET still work.
 * Session: signed HMAC cookie, HttpOnly + Secure + SameSite=Strict, 8-hour expiry.
 */
const BASE = "/api/echowall/admin";
const COOKIE = "__Host-echowall_admin";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 8_000;
const encoder = new TextEncoder();
const REPORT_STATUSES = new Set(["pending", "reviewed", "dismissed"]);
const REPORT_FILTERS = new Set(["pending", "reviewed", "dismissed", "all"]);
const POST_FILTERS = new Set(["visible", "hidden", "deleted", "all"]);
const POST_ACTIONS = { hide: "hidden", restore: "visible" };
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
// Best-effort per-isolate throttle. Durable rate limiting belongs in D1/KV.
const loginFailures = new Map();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}
function fail(message, status = 400) { return json({ success: false, error: message }, status); }
function methodNotAllowed(allow) { return json({ success: false, error: "请求方法不支持。" }, 405, { allow }); }

function bytesToB64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function importHmac(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function signPayload(payload, secret) {
  const body = bytesToB64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importHmac(secret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${bytesToB64Url(signature)}`;
}
async function verifyToken(token, secret) {
  if (!token || token.length > 2_000) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await importHmac(secret);
    const valid = await crypto.subtle.verify("HMAC", key, b64UrlToBytes(parts[1]), encoder.encode(parts[0]));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(parts[0])));
    if (!payload || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (_) { return null; }
}
function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const item of cookie.split(";")) {
    const index = item.indexOf("=");
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) return item.slice(index + 1).trim();
  }
  return "";
}
function sessionCookie(token) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}
function clearSessionCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}
async function readJson(request) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY_BYTES) return { error: "请求内容过大。" };
    const raw = await request.text();
    if (encoder.encode(raw).byteLength > MAX_BODY_BYTES) return { error: "请求内容过大。" };
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "请求格式不正确。" };
    return { value };
  } catch (_) { return { error: "请求 JSON 格式不正确。" }; }
}
function safeEqualsString(a, b) {
  // Compare fixed-length SHA-256 digests to avoid obvious early-exit timing leaks.
  return Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(a)), crypto.subtle.digest("SHA-256", encoder.encode(b))])
    .then(([x, y]) => {
      const xa = new Uint8Array(x), ya = new Uint8Array(y);
      let diff = 0;
      for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ ya[i];
      return diff === 0;
    });
}
function configuredAdminPassword(env) {
  return env.administrator || env.ECHOWALL_ADMIN_PASSWORD || null;
}
async function configuredSessionSecret(env) {
  if (env.administrator) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`echowall-session-v1:${env.administrator}`));
    return bytesToB64Url(new Uint8Array(digest));
  }
  return env.ECHOWALL_ADMIN_SESSION_SECRET || null;
}
async function authenticate(request, env) {
  const secret = await configuredSessionSecret(env);
  if (!secret) return null;
  return verifyToken(getCookie(request, COOKIE), secret);
}
function isSameOrigin(request, url) {
  // All browser mutations require an Origin header matching this site's origin.
  return request.headers.get("origin") === url.origin;
}
function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}
function loginAttemptCount(key) {
  const now = Date.now();
  const item = loginFailures.get(key);
  if (!item) return 0;
  if (now - item.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return 0;
  }
  return item.count;
}
function recordLoginFailure(key) {
  const now = Date.now();
  const item = loginFailures.get(key);
  if (!item || now - item.first > LOGIN_WINDOW_MS) loginFailures.set(key, { first: now, count: 1 });
  else item.count += 1;
  if (loginFailures.size > 1_000) {
    for (const [keyName, entry] of loginFailures) {
      if (now - entry.first > LOGIN_WINDOW_MS) loginFailures.delete(keyName);
    }
  }
}
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

async function login(request, env, url) {
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!isSameOrigin(request, url)) return fail("来源校验失败，请从本站管理页面操作。", 403);
  const adminPassword = configuredAdminPassword(env);
  const sessionSecret = await configuredSessionSecret(env);
  if (!adminPassword || !sessionSecret) {
    return fail("管理员 Secret 尚未配置。请配置 administrator。", 503);
  }
  const key = clientKey(request);
  if (loginAttemptCount(key) >= LOGIN_MAX_FAILURES) {
    return json({ success: false, error: "登录尝试过于频繁，请 10 分钟后再试。" }, 429, {
      "retry-after": String(Math.ceil(LOGIN_WINDOW_MS / 1000)),
    });
  }
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, 400);
  const password = typeof parsed.value.password === "string" ? parsed.value.password : "";
  const validLength = password.length >= 1 && password.length <= 512;
  const matched = validLength && await safeEqualsString(password, adminPassword);
  if (!matched) {
    recordLoginFailure(key);
    return fail("密码不正确。", 401);
  }
  loginFailures.delete(key);
  const now = Math.floor(Date.now() / 1000);
  const token = await signPayload({ role: "admin", iat: now, exp: now + SESSION_TTL_SECONDS }, sessionSecret);
  return json({ success: true, authenticated: true, expiresAt: (now + SESSION_TTL_SECONDS) * 1000 }, 200, { "set-cookie": sessionCookie(token) });
}
async function listReports(env, url) {
  const status = url.searchParams.get("status") || "pending";
  if (!REPORT_FILTERS.has(status)) return fail("举报状态无效。", 400);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50) || 50));
  const filter = status === "all" ? "" : "WHERE r.status = ?";
  const statement = env.DB.prepare(`
    SELECT r.id, r.post_id AS postId, r.reason, r.details, r.created_at AS createdAt,
           r.status, r.admin_note AS adminNote, r.reviewed_at AS reviewedAt,
           p.author AS postAuthor, p.content AS postContent,
           p.created_at AS postCreatedAt, p.status AS postStatus, p.likes_count AS postLikes
    FROM echowall_reports r
    LEFT JOIN echowall_posts p ON p.id = r.post_id
    ${filter}
    ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
    LIMIT ?`);
  const result = status === "all" ? await statement.bind(limit).all() : await statement.bind(status, limit).all();
  const countRows = await env.DB.prepare("SELECT status, COUNT(*) AS total FROM echowall_reports GROUP BY status").all();
  const counts = { pending: 0, reviewed: 0, dismissed: 0 };
  for (const row of countRows.results || []) if (Object.hasOwn(counts, row.status)) counts[row.status] = Number(row.total) || 0;
  return json({ success: true, reports: result.results || [], counts });
}
async function listPosts(env, url) {
  const status = url.searchParams.get("status") || "visible";
  if (!POST_FILTERS.has(status)) return fail("帖子状态无效。", 400);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 50) || 50));
  const q = String(url.searchParams.get("q") || "").trim().slice(0, 100);
  const clauses = [];
  const values = [];
  if (status !== "all") { clauses.push("p.status = ?"); values.push(status); }
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    clauses.push("(p.author LIKE ? ESCAPE '\\' OR p.content LIKE ? ESCAPE '\\' OR p.id LIKE ? ESCAPE '\\')");
    values.push(pattern, pattern, pattern);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await env.DB.prepare(`
    SELECT p.id, p.author, p.content AS content, p.created_at AS createdAt,
           p.status, p.likes_count AS likes,
           (SELECT COUNT(*) FROM echowall_reports r WHERE r.post_id = p.id AND r.status = 'pending') AS pendingReports
    FROM echowall_posts p ${where}
    ORDER BY p.created_at DESC LIMIT ?`).bind(...values, limit).all();
  return json({ success: true, posts: result.results || [] });
}
async function reviewReport(request, env, reportId) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, 400);
  const status = parsed.value.status;
  if (!REPORT_STATUSES.has(status)) return fail("举报状态无效。", 400);
  const note = typeof parsed.value.note === "string" ? parsed.value.note.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, 500) : "";
  const existing = await env.DB.prepare("SELECT id FROM echowall_reports WHERE id = ?").bind(reportId).first();
  if (!existing) return fail("举报记录不存在。", 404);
  await env.DB.prepare("UPDATE echowall_reports SET status = ?, admin_note = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?")
    .bind(status, note, status === "pending" ? null : Date.now(), status === "pending" ? null : "admin", reportId).run();
  return json({ success: true });
}
async function deletePost(env, postId) {
  const existing = await env.DB.prepare("SELECT id, status FROM echowall_posts WHERE id = ?").bind(postId).first();
  if (!existing) return fail("帖子不存在。", 404);
  // 硬删除：先清理依赖记录，避免外键约束阻止删除帖子。
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM echowall_reports WHERE post_id = ?").bind(postId),
    env.DB.prepare("DELETE FROM echowall_likes WHERE post_id = ?").bind(postId),
    env.DB.prepare("DELETE FROM echowall_posts WHERE id = ?").bind(postId),
  ]);
  return json({
    success: true,
    id: postId,
    deleted: true,
    previousStatus: existing.status,
    removedReports: Number(results[0]?.meta?.changes || 0),
    removedLikes: Number(results[1]?.meta?.changes || 0),
  });
}
async function changePost(request, env, postId) {
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, 400);
  const action = parsed.value.action;
  if (action === "delete") return await deletePost(env, postId);
  const nextStatus = POST_ACTIONS[action];
  if (!nextStatus) return fail("不支持的帖子操作。", 400);
  const existing = await env.DB.prepare("SELECT id, status FROM echowall_posts WHERE id = ?").bind(postId).first();
  if (!existing) return fail("帖子不存在。", 404);
  const statements = [
    env.DB.prepare("UPDATE echowall_posts SET status = ? WHERE id = ?").bind(nextStatus, postId),
  ];
  // Hiding a post resolves its pending reports so the queue stays actionable.
  if (nextStatus === "hidden") {
    statements.push(env.DB.prepare(
      "UPDATE echowall_reports SET status = 'reviewed', admin_note = ?, reviewed_at = ?, reviewed_by = 'admin' WHERE post_id = ? AND status = 'pending'"
    ).bind("管理员已隐藏该帖子。", Date.now(), postId));
  }
  const results = await env.DB.batch(statements);
  const resolvedReports = statements.length > 1 ? Number(results[1]?.meta?.changes || 0) : 0;
  return json({ success: true, id: postId, previousStatus: existing.status, status: nextStatus, resolvedReports });
}

export async function handleEchowallAdminApi(request, env) {
  const url = new URL(request.url);
  if (!(url.pathname === BASE || url.pathname.startsWith(`${BASE}/`))) return null;
  if (!env || !env.DB) return fail("D1 尚未绑定到 Worker（预期绑定名为 DB）。", 503);

  try {
    if (url.pathname === `${BASE}/login`) return await login(request, env, url);
    if (url.pathname === `${BASE}/session`) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      const session = await authenticate(request, env);
      const authenticated = session?.role === "admin";
      return json({ success: true, authenticated, expiresAt: authenticated ? session.exp * 1000 : null });
    }
    if (url.pathname === `${BASE}/logout`) {
      if (request.method !== "POST") return methodNotAllowed("POST");
      if (!isSameOrigin(request, url)) return fail("来源校验失败。", 403);
      return json({ success: true }, 200, { "set-cookie": clearSessionCookie() });
    }

    const session = await authenticate(request, env);
    if (!session || session.role !== "admin") return fail("需要管理员登录。", 401);

    if (url.pathname === `${BASE}/reports`) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return await listReports(env, url);
    }
    if (url.pathname === `${BASE}/posts`) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return await listPosts(env, url);
    }
    const reportMatch = url.pathname.match(/^\/api\/echowall\/admin\/reports\/([^/]+)$/);
    if (reportMatch) {
      if (!isSameOrigin(request, url)) return fail("来源校验失败。", 403);
      if (request.method !== "PATCH" && request.method !== "POST") return methodNotAllowed("PATCH, POST");
      let id;
      try { id = decodeURIComponent(reportMatch[1]); } catch (_) { return fail("举报 ID 无效。", 400); }
      if (!id || id.length > 100) return fail("举报 ID 无效。", 400);
      return await reviewReport(request, env, id);
    }
    const postMatch = url.pathname.match(/^\/api\/echowall\/admin\/posts\/([^/]+)$/);
    if (postMatch) {
      if (!isSameOrigin(request, url)) return fail("来源校验失败。", 403);
      if (request.method !== "POST" && request.method !== "PATCH") return methodNotAllowed("POST, PATCH");
      let id;
      try { id = decodeURIComponent(postMatch[1]); } catch (_) { return fail("帖子 ID 无效。", 400); }
      if (!id || id.length > 100) return fail("帖子 ID 无效。", 400);
      return await changePost(request, env, id);
    }
    return fail("管理 API 路由不存在。", 404);
  } catch (error) {
    console.error("Echowall admin API error:", error);
    return fail("管理后台暂时无法处理请求，请检查 Worker 日志。", 500);
  }
}
