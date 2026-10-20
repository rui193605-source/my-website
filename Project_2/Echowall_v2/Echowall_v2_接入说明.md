# Echowall V2：前端、D1 表结构与 Worker API 接入说明

## 本版完成内容

- 保留发帖、点赞/取消点赞、最新/最热排序、删除自己发布的帖子。
- 增加每条帖子下方的举报按钮。举报使用弹窗，包含垃圾广告、骚扰/辱骂、隐私泄露、违法/危险内容、其他原因，以及可选补充说明。
- 增加可直接使用的管理后台：管理员密码登录、举报队列、帖子搜索，以及隐藏 / 软删除 / 恢复帖子。
- 调整卡片层级、间距、按钮热区、空状态、连接状态和手机端布局。
- 未连接 API 时自动进入本地预览，支持浏览器本地保存；连接 API 后切换为云端请求，不会在写入失败时悄悄改存到本地。
- 提供 D1 表结构和可合并到现有 Worker 的路由模块。数据表均带 `echowall_` 前缀，避免与网站其他功能的表名冲突。

## 重要说明：纯前端不能直接安全地写入 D1

浏览器页面不应该持有可访问数据库的凭据。正确链路是：

`Echowall.html → 同源 Worker API (/api/echowall/...) → Worker 的 D1 binding → D1`

页面已经按这条链路实现请求。`echowall_api.js` 是后端路由模块，不是完整 Worker 项目，目的是并入你现有 Worker，并保留原来 `/api/ip`、`/api/weather`、`/api/geocode`、`/api/reverse` 等路由。

## 文件

- `Echowall_v2.html`：留言墙前端页面，顶栏“管理后台”已链接到 `admin.html`。
- `admin.html`：管理控制台页面，负责举报审核和帖子状态管理。
- `echowall_d1_schema.sql`：创建帖子、点赞、举报三类数据表。
- `echowall_api.js`：公开 API 路由，约定数据库 binding 为 `env.DB`。
- `echowall_admin_api.js`：管理 API 路由，使用密码登录和签名 Cookie 会话。
- `worker.js`：当前项目实际部署入口，已同时接入公开 API 与管理 API。

## 接入步骤

### 1. 放置前端

先把 `Echowall_v2.html` 在本地浏览器中打开测试。确认后，再复制到 GitHub 仓库中网站对应的静态文件目录，部署位置保持你原来的 Echowall 页面路径即可。此时如果尚未接入 API，页面应显示“本地预览”。

### 2. 将 SQL 导入 D1

以下命令适用于你已经创建好 D1 数据库、并在终端安装/使用 Wrangler 的情况：

```bash
npx wrangler d1 execute <你的D1数据库名称> --remote --file=echowall_d1_schema.sql
```

将 `<你的D1数据库名称>` 换成 Cloudflare D1 中真实的数据库名称。不要把占位符原样运行。

如果暂时不方便使用终端，也可以在 Cloudflare Dashboard 的 D1 数据库 SQL/Query 页面打开 `echowall_d1_schema.sql`，执行其中的 SQL。请确认选中的是目标数据库。

如果 `echowall_reports` 是旧版本创建的表、缺少审核字段，需要补执行：

```sql
ALTER TABLE echowall_reports ADD COLUMN admin_note TEXT NOT NULL DEFAULT '';
ALTER TABLE echowall_reports ADD COLUMN reviewed_at INTEGER;
ALTER TABLE echowall_reports ADD COLUMN reviewed_by TEXT;
```

字段已存在时不要重复执行，否则 D1 会报重复列错误。

### 3. 绑定 D1

在现有 Worker 的 Wrangler 配置（`wrangler.toml` 或 `wrangler.jsonc`）中，为现有 D1 增加或确认 binding。示例仅用于说明字段，不要照抄虚构的数据库 ID：

```toml
[[d1_databases]]
binding = "DB"
database_name = "你的真实数据库名称"
database_id = "你的真实数据库UUID"
```

如果现有配置已经有 D1 binding，不要重复添加同一个 binding；应当沿用现有配置。如果你的 binding 不是 `DB`，请将 `echowall_api.js` 内 `env.DB` 改成你实际使用的绑定名。

### 4. 把路由并入现有 Worker

将 `echowall_api.js` 放到 Worker 入口文件旁边，然后在现有入口文件顶部添加：

```js
import { handleEchowallApi } from "./Project_2/Echowall_v2/echowall_api.js";
import { handleEchowallAdminApi } from "./Project_2/Echowall_v2/echowall_admin_api.js";
```

在现有 `fetch(request, env, ctx)` 处理逻辑里，尽量放到静态资源兜底和通用 404 逻辑之前，加入：

```js
const url = new URL(request.url);
if (url.pathname === "/api/echowall" || url.pathname.startsWith("/api/echowall/")) {
  // 管理 API 先分派，非 /admin 路径会返回 null。
  const adminResponse = await handleEchowallAdminApi(request, env);
  if (adminResponse) return adminResponse;
  return await handleEchowallApi(request, env);
}
```

**只合并这段路由，不要用一个新 `export default` 覆盖你现有 Worker。** 这样原来的网站 API 路由可以继续保留。若你的项目使用 Hono 或其他路由框架，需要把同样的路径分派逻辑加进原路由系统，而不是机械复制上面的 `fetch` 代码。

当前仓库的根目录 `worker.js` 已经完成上述接入；`Project_2/Echowall_v2/worker.js` 是同一份入口的副本，导入路径已按所在目录调整为 `./echowall_api.js` 和 `./echowall_admin_api.js`。实际部署入口由根目录 `wrangler.toml` 的 `main = "worker.js"` 决定，修改时请以根目录文件为准。

### 5. 验证

部署后访问：

`https://你的域名/api/echowall/posts`

浏览器直接访问接口时没有 `X-Echowall-Visitor` 头，返回“缺少或无效的访客标识”是预期的；真正的测试应从 Echowall 页面进行。如果页面顶栏显示“云端 API 已连接”，说明 API 读取成功。可以尝试发布一条测试帖子，然后刷新页面，再换另一个浏览器/设备查看是否共享。

若页面一直显示“本地预览”，优先检查：路由是否合并、D1 binding 是否叫 `DB`、SQL 是否已执行、部署是否成功。前端本地模式仍可用于设计验证，但不会把本地的示例数据自动迁移到 D1。

顶栏的连接状态按钮可以点击：本地预览时会重试连接云端 API，云端模式下会立即同步最新列表。页面回到前台或网络恢复时，云端模式也会自动做一次轻量同步。

### 6. 配置管理后台

管理后台只需要一个 Cloudflare Secret：

```bash
npx wrangler secret put administrator
```

- `administrator`：管理员登录密码。Worker 会基于它派生 8 小时会话 Cookie 的签名密钥；修改该 Secret 会使旧会话立即失效。
- 若仍保留旧版 `ECHOWALL_ADMIN_PASSWORD` / `ECHOWALL_ADMIN_SESSION_SECRET`，代码会继续兼容；两者都存在时优先使用 `administrator`。

配置后重新部署，访问 `/Project_2/Echowall_v2/admin.html` 登录。管理后台与留言墙同源，因此会话 Cookie 可以正常写入并随请求发送。直接双击打开本地 HTML 文件无法登录，也不会写入 D1。

## API 路由约定

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/echowall/posts?sort=latest` | 获取最新帖子 |
| GET | `/api/echowall/posts?sort=hot` | 获取热门帖子 |
| POST | `/api/echowall/posts` | 发布帖子 |
| POST | `/api/echowall/posts/:id/like` | 设置当前访客的点赞状态 `{ "liked": true/false }` |
| POST | `/api/echowall/posts/:id/reports` | 提交举报 `{ "reason": "spam", "details": "..." }` |
| DELETE | `/api/echowall/posts/:id` | 删除当前访客自己发布的帖子 |

列表接口的每条帖子会同时返回 `liked`、`mine`、`reported`，前端据此同步点赞状态、显示“我的帖子”和禁用已举报按钮。已匹配路径但方法不支持时返回 405。

举报记录在 `echowall_reports` 表中初始状态为 `pending`。管理后台可以按状态筛选并处理举报；隐藏或删除被举报帖子时，该帖子的待处理举报会自动标记为已处理。

管理 API：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| POST | `/api/echowall/admin/login` | 管理员密码登录 |
| GET | `/api/echowall/admin/session` | 查询当前会话 |
| POST | `/api/echowall/admin/logout` | 退出登录 |
| GET | `/api/echowall/admin/reports?status=...` | 举报队列与统计 |
| PATCH | `/api/echowall/admin/reports/:id` | 更新举报状态与备注 |
| GET | `/api/echowall/admin/posts?status=...&q=...` | 管理帖子列表 |
| POST | `/api/echowall/admin/posts/:id` | 隐藏 / 删除 / 恢复帖子 |

管理 API 的写操作要求同源 `Origin`，会话 Cookie 为 `HttpOnly + Secure + SameSite=Strict`，有效期 8 小时；登录失败次数在同一 Worker 实例内有限流。

## 当前原型的安全边界

本版通过浏览器 localStorage 生成一个匿名访客 ID，Worker 用它区分点赞、判断“我的帖子”和限制同一个访客重复举报。这是无账号原型的轻量方案，不是可靠的身份验证；访客可以清理或伪造本地 ID。正式公开给更多用户使用之前，建议补上 Cloudflare Turnstile、持久化速率限制和异常请求防护。管理后台已使用密码登录与签名会话，但管理员密码必须只配置在 Cloudflare Secret `administrator` 中，绝不能写入前端 HTML。

## 设计参考

举报交互采用社区产品常见模式：由用户先选择明确的举报原因，再允许补充说明。可参考 Discourse 的帖子举报/Flag 工作流；审核后台设计可以借鉴 Reddit Moderator Queue 的状态筛选与举报原因呈现方式：

- https://meta.discourse.org/t/new-its-illegal-reason-when-flagging-posts/294866
- https://support.reddithelp.com/hc/en-us/articles/15484440494356-Moderation-Queue

D1 通过 Worker binding 访问，不是由网页直接连接数据库。相关官方文档：

- https://developers.cloudflare.com/d1/worker-api/
- https://developers.cloudflare.com/d1/wrangler-commands/
- https://developers.cloudflare.com/workers/wrangler/configuration/
