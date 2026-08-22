// Run: node scripts/045_writer_sessions.mjs
//
// The writing agent's session state. `phase` is the single source of truth for where a session is
// in the 4-step workflow — the model transitions it only by calling save_brief / propose_outline
// / submit_section, and outline_pending → approved only happens via a human HTTP call
// (POST /api/blog/writer/[id]/approve). There is deliberately no tool the model can call to make
// that last transition itself.
//
// writer_messages stores raw Anthropic content blocks, not display text: thinking blocks must be
// replayed unchanged on the same model, and tool_use/tool_result pairing must survive a reload, so
// display-only text would lose exactly the information a resumed session needs.
import pg from "pg"; import * as dotenv from "dotenv";
import { fileURLToPath } from "url"; import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`
  CREATE TABLE IF NOT EXISTS writer_clusters (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    voice_id        uuid REFERENCES writer_voices(id),
    pillar_keyword  text NOT NULL,
    title           text,
    keyword_source  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- raw GSC rows the plan was built from
    plan            jsonb,                                 -- {pillar:{...}, supporting:[...]}
    status          text NOT NULL DEFAULT 'planning',
    -- planning | plan_pending | approved | running | done | partial | failed
    approved_at     timestamptz,
    approved_by     text,
    total           int NOT NULL DEFAULT 0,
    done            int NOT NULL DEFAULT 0,
    failed          int NOT NULL DEFAULT 0,
    cursor          int NOT NULL DEFAULT 0,                -- resume index, enrich/run.ts pattern
    error           text,
    created_by      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS writer_sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    voice_id            uuid REFERENCES writer_voices(id),
    voice_revision      int,                    -- writer_voices.prompt_revision at session start
    kind                text NOT NULL DEFAULT 'single',   -- single | cluster_member
    phase               text NOT NULL DEFAULT 'gathering',
    -- gathering | researching | outline_pending | approved | writing | validating | done | failed
    brief               jsonb NOT NULL DEFAULT '{}'::jsonb,
    research            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {sources:{}, keyword_rows:[]}
    outline             jsonb,
    outline_approved_at timestamptz,
    outline_approved_by text,
    section_cursor      int NOT NULL DEFAULT 0,
    draft_id            uuid REFERENCES blog_drafts(id) ON DELETE SET NULL,
    cluster_id          uuid REFERENCES writer_clusters(id) ON DELETE CASCADE,
    usage               jsonb NOT NULL DEFAULT '{}'::jsonb,  -- running cache/token totals
    error               text,
    created_by          text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS writer_sessions_phase_idx   ON writer_sessions (phase, updated_at DESC);
  CREATE INDEX IF NOT EXISTS writer_sessions_cluster_idx ON writer_sessions (cluster_id);
  CREATE INDEX IF NOT EXISTS writer_sessions_draft_idx   ON writer_sessions (draft_id);

  CREATE TABLE IF NOT EXISTS writer_messages (
    id         bigserial PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES writer_sessions(id) ON DELETE CASCADE,
    seq        int  NOT NULL,
    role       text NOT NULL,        -- user | assistant
    blocks     jsonb NOT NULL,       -- Anthropic.ContentBlockParam[], verbatim
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS writer_messages_seq_idx ON writer_messages (session_id, seq);
`);

// blog_drafts gains the writer-facing columns. Also: 035 made strapi_id unique but never slug,
// even though slug is what Strapi's own uid uniqueness depends on — unattended cluster generation
// would collide on it today. Added here since it's this phase that first writes drafts unattended.
await c.query(`
  ALTER TABLE blog_drafts
    ADD COLUMN IF NOT EXISTS writer_status     text,      -- ok | flagged | failed
    ADD COLUMN IF NOT EXISTS writer_qa         jsonb,
    ADD COLUMN IF NOT EXISTS writer_session_id uuid,
    ADD COLUMN IF NOT EXISTS cluster_id        uuid;

  CREATE UNIQUE INDEX IF NOT EXISTS blog_drafts_slug_idx ON blog_drafts (slug) WHERE slug <> '';
`);

for (const t of ["writer_clusters", "writer_sessions", "writer_messages"]) {
  const { rows } = await c.query(
    `SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || $1)::regclass`, [t]);
  if (!rows[0]?.relrowsecurity) {
    await c.query(`ALTER TABLE public."${t}" ENABLE ROW LEVEL SECURITY`);
    console.log(`  ✓ RLS enabled: ${t}`);
  }
}

console.log("045 done: writer_clusters, writer_sessions, writer_messages created; blog_drafts extended.");
await c.end();
