-- Echowall D1 schema
-- Run this against the D1 database bound to the Worker as env.DB.
-- These tables use an echowall_ prefix so they can coexist with your site's other APIs.

CREATE TABLE IF NOT EXISTS echowall_posts (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL DEFAULT '路过的朋友' CHECK (length(author) BETWEEN 1 AND 24),
  content TEXT NOT NULL CHECK (length(content) <= 280),
  author_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
  likes_count INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_echowall_posts_visible_created
  ON echowall_posts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_echowall_posts_visible_likes
  ON echowall_posts(status, likes_count DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_echowall_posts_author
  ON echowall_posts(author_key, created_at DESC);

CREATE TABLE IF NOT EXISTS echowall_likes (
  post_id TEXT NOT NULL,
  visitor_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, visitor_key),
  FOREIGN KEY (post_id) REFERENCES echowall_posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_echowall_likes_post
  ON echowall_likes(post_id);

CREATE INDEX IF NOT EXISTS idx_echowall_likes_visitor
  ON echowall_likes(visitor_key);

CREATE TABLE IF NOT EXISTS echowall_reports (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'privacy', 'illegal', 'other')),
  details TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 200),
  reporter_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  admin_note TEXT NOT NULL DEFAULT '',
  reviewed_at INTEGER,
  reviewed_by TEXT,
  UNIQUE (post_id, reporter_key),
  FOREIGN KEY (post_id) REFERENCES echowall_posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_echowall_reports_status_created
  ON echowall_reports(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_echowall_reports_post
  ON echowall_reports(post_id);

CREATE INDEX IF NOT EXISTS idx_echowall_reports_post_status
  ON echowall_reports(post_id, status);

CREATE INDEX IF NOT EXISTS idx_echowall_reports_reporter
  ON echowall_reports(reporter_key, created_at DESC);
