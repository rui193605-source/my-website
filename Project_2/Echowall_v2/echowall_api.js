/**
 * Echowall D1 API route module.
 * This is a route handler to merge into your existing Cloudflare Worker,
 * not a replacement for your current Worker entrypoint.
 *
 * Expected D1 binding: env.DB
 * Routes: /api/echowall/posts, /api/echowall/posts/:id/like,
 *         /api/echowall/posts/:id/reports
 * Post deletion is admin-only and handled by echowall_admin_api.js.
 */
const BASE_PATH = "/api/echowall";
const VALID_REPORT_REASONS = new Set(["spam", "harassment", "privacy", "illegal", "other"]);
const MAX_BODY_BYTES = 20_000;
const MAX_AUTHOR_CHARS = 24;
const MAX_CONTENT_CHARS = 280;
const MAX_DETAILS_CHARS = 200;
const MAX_POST_ID_LENGTH = 100;
const NEWLINE_SAFE_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const ALL_CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function fail(message, status = 400) {
  return json({ success: false, error: message }, status);
}

function methodNotAllowed(allow) {
  return new Response(JSON.stringify({ success: false, error: "请求方法不支持。" }), {
    status: 405,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "allow": allow,
    },
  });
}

function textChars(value) {
  return Array.from(String(value)).length;
}

function clampChars(value, max) {
  const chars = Array.from(String(value));
  return chars.length > max ? chars.slice(0, max).join("") : chars.join("");
}

function sanitizeText(value, keepNewlines = false) {
  return String(value ?? "").replace(keepNewlines ? NEWLINE_SAFE_CONTROL_CHARS : ALL_CONTROL_CHARS, "");
}

function validVisitor(request) {
  const value = request.headers.get("X-Echowall-Visitor") || "";
  // A browser-generated pseudonymous ID, not an authenticated user identity.
  return /^[A-Za-z0-9._:-]{10,100}$/.test(value) ? value : null;
}

function postIdFromSegment(segment) {
  try {
    const value = decodeURIComponent(segment);
    return value && value.length <= MAX_POST_ID_LENGTH ? value : null;
  } catch (_) {
    return null;
  }
}

async function readJson(request) {
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES) return { error: "请求内容过大。" };
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return { error: "请求内容过大。" };
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "请求格式不正确。" };
    return { value };
  } catch (_) {
    return { error: "请求 JSON 格式不正确。" };
  }
}

function rowToPost(row) {
  return {
    id: row.id,
    author: row.author,
    text: row.text,
    createdAt: Number(row.createdAt),
    likes: Number(row.likes) || 0,
    liked: Number(row.liked) === 1,
    mine: Number(row.mine) === 1,
    reported: Number(row.reported) === 1,
    demo: false,
  };
}

async function listPosts(request, env, url) {
  const visitor = validVisitor(request);
  if (!visitor) return fail("缺少或无效的访客标识。", 400);
  const sort = url.searchParams.get("sort") === "hot" ? "hot" : "latest";
  const order = sort === "hot" ? "p.likes_count DESC, p.created_at DESC" : "p.created_at DESC";
  const query = `
    SELECT p.id, p.author, p.content AS text, p.created_at AS createdAt,
           p.likes_count AS likes,
           EXISTS(SELECT 1 FROM echowall_likes l WHERE l.post_id = p.id AND l.visitor_key = ?) AS liked,
           CASE WHEN p.author_key = ? THEN 1 ELSE 0 END AS mine,
           EXISTS(SELECT 1 FROM echowall_reports r WHERE r.post_id = p.id AND r.reporter_key = ?) AS reported
    FROM echowall_posts p
    WHERE p.status = 'visible'
    ORDER BY ${order}
    LIMIT 100`;
  const result = await env.DB.prepare(query).bind(visitor, visitor, visitor).all();
  return json({ success: true, posts: (result.results || []).map(rowToPost) });
}

async function createPost(request, env) {
  const visitor = validVisitor(request);
  if (!visitor) return fail("缺少或无效的访客标识。", 400);
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, 400);
  const author = clampChars(sanitizeText(parsed.value.author).trim(), MAX_AUTHOR_CHARS) || "路过的朋友";
  const text = sanitizeText(parsed.value.text, true).trim();
  const chars = textChars(text);
  if (!text) return fail("帖子内容不能为空。", 400);
  if (chars > MAX_CONTENT_CHARS) return fail(`帖子内容不能超过 ${MAX_CONTENT_CHARS} 字。`, 400);
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  await env.DB.prepare(
    "INSERT INTO echowall_posts (id, author, content, author_key, created_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(id, author, text, visitor, createdAt).run();
  return json({ success: true, post: { id, author, text, createdAt, likes: 0, liked: false, mine: true, reported: false, demo: false } }, 201);
}

async function toggleLike(request, env, postId) {
  const visitor = validVisitor(request);
  if (!visitor) return fail("缺少或无效的访客标识。", 400);
  const post = await env.DB.prepare("SELECT id FROM echowall_posts WHERE id = ? AND status = 'visible'").bind(postId).first();
  if (!post) return fail("帖子不存在或已不可见。", 404);
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, 400);
  if (typeof parsed.value.liked !== "boolean") return fail("liked 必须是布尔值。", 400);

  const statements = [];
  if (parsed.value.liked) {
    statements.push(env.DB.prepare(
      "INSERT OR IGNORE INTO echowall_likes (post_id, visitor_key, created_at) VALUES (?, ?, ?)"
    ).bind(postId, visitor, Date.now()));
  } else {
    statements.push(env.DB.prepare("DELETE FROM echowall_likes WHERE post_id = ? AND visitor_key = ?").bind(postId, visitor));
  }
  // Recount from the source table rather than incrementing blindly. This keeps
  // the displayed count robust against repeated clicks or retried requests.
  statements.push(env.DB.prepare(
    "UPDATE echowall_posts SET likes_count = (SELECT COUNT(*) FROM echowall_likes WHERE post_id = ?) WHERE id = ?"
  ).bind(postId, postId));
  await env.DB.batch(statements);
  const result = await env.DB.prepare(
    "SELECT likes_count AS likes, EXISTS(SELECT 1 FROM echowall_likes WHERE post_id = ? AND visitor_key = ?) AS liked FROM echowall_posts WHERE id = ?"
  ).bind(postId, visitor, postId).first();
  return json({ success: true, likes: Number(result?.likes) || 0, liked: Number(result?.liked) === 1 });
}

async function createReport(request, env, postId) {
  const visitor = validVisitor(request);
  if (!visitor) return fail("缺少或无效的访客标识。", 400);
  const post = await env.DB.prepare("SELECT id FROM echowall_posts WHERE id = ? AND status = 'visible'").bind(postId).first();
  if (!post) return fail("帖子不存在或已不可见。", 404);
  const parsed = await readJson(request);
  if (parsed.error) return fail(parsed.error, 400);
  const reason = String(parsed.value.reason || "");
  if (!VALID_REPORT_REASONS.has(reason)) return fail("请选择有效的举报原因。", 400);
  const details = sanitizeText(parsed.value.details, true).trim();
  if (textChars(details) > MAX_DETAILS_CHARS) return fail(`举报说明不能超过 ${MAX_DETAILS_CHARS} 字。`, 400);
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      "INSERT INTO echowall_reports (id, post_id, reason, details, reporter_key, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(id, postId, reason, details, visitor, Date.now()).run();
  } catch (error) {
    const message = String(error?.message || "").toLowerCase();
    if (message.includes("unique constraint")) {
      return fail("你已经举报过这条内容。", 409);
    }
    throw error;
  }
  return json({ success: true, reportId: id, status: "pending" }, 201);
}

export async function handleEchowallApi(request, env) {
  const url = new URL(request.url);
  if (!(url.pathname === BASE_PATH || url.pathname.startsWith(`${BASE_PATH}/`))) return null;
  if (!env || !env.DB) return fail("D1 尚未绑定到 Worker（预期绑定名为 DB）。", 503);

  try {
    if (url.pathname === `${BASE_PATH}/posts`) {
      if (request.method === "GET") return await listPosts(request, env, url);
      if (request.method === "POST") return await createPost(request, env);
      return methodNotAllowed("GET, POST");
    }

    const likeMatch = url.pathname.match(/^\/api\/echowall\/posts\/([^/]+)\/like$/);
    if (likeMatch) {
      if (request.method !== "POST") return methodNotAllowed("POST");
      const postId = postIdFromSegment(likeMatch[1]);
      if (!postId) return fail("帖子 ID 无效。", 400);
      return await toggleLike(request, env, postId);
    }

    const reportMatch = url.pathname.match(/^\/api\/echowall\/posts\/([^/]+)\/reports$/);
    if (reportMatch) {
      if (request.method !== "POST") return methodNotAllowed("POST");
      const postId = postIdFromSegment(reportMatch[1]);
      if (!postId) return fail("帖子 ID 无效。", 400);
      return await createReport(request, env, postId);
    }

    const postMatch = url.pathname.match(/^\/api\/echowall\/posts\/([^/]+)$/);
    if (postMatch) {
      // 帖子删除仅限管理员通过管理后台执行；公开 API 不再接受访客删除。
      if (request.method === "DELETE") return fail("删除帖子仅限管理员操作。", 403);
      return fail("Echowall API 路由不存在。", 404);
    }

    return fail("Echowall API 路由不存在。", 404);
  } catch (error) {
    console.error("Echowall API error:", error);
    return fail("服务器暂时无法处理请求，请稍后重试。", 500);
  }
}
