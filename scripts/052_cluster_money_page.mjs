// Link a blog cluster to the landing page it exists to support.
//
// The gap this closes: a cluster's entire purpose is to make one money page rank, and
// `references/blog-cluster-template.md` builds every interlinking rule around that page ("every post →
// money page, money page → pillar"). But `writer_clusters` had no money-page column at all, so the
// relationship lived only in whoever's head planned it. That means the interlinking rules could not be
// computed server-side, which is the one place they must be computed — asking the model for the link graph
// lets it invent a sibling that does not exist.
//
// Two columns rather than one, deliberately:
//
//   landing_page_id   FK to a tracked landing_pages row. The normal case, and it gives us the page's
//                     brief and stage so supporting posts can map to real sections of it.
//   money_page_url    The resolved URL. Denormalised on purpose: a cluster can target a page that was
//                     never tracked in landing_pages (most of imagine.art predates this tool), and the
//                     posts' interlinks must keep pointing at a stable URL even if the landing row is
//                     later deleted. ON DELETE SET NULL below relies on this.
import * as dotenv from "dotenv";
import pg from "pg";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../.env.local"), quiet: true });
const c = new pg.Client({ connectionString: process.env.DATABASE_URL }); await c.connect();

await c.query(`ALTER TABLE writer_clusters ADD COLUMN IF NOT EXISTS money_page_url text`);

// SET NULL, not CASCADE: deleting a landing page must never delete the cluster of posts written to
// support it. Those posts are real published work; the link is metadata. money_page_url survives, so the
// cluster still knows what it was pointing at.
await c.query(`
  ALTER TABLE writer_clusters
    ADD COLUMN IF NOT EXISTS landing_page_id uuid
    REFERENCES landing_pages(id) ON DELETE SET NULL`);

// Answers "does this landing page already have a cluster?" — needed by the /landing list to decide
// whether to offer "Make cluster" or link to the existing one. Partial, since most clusters have no
// landing page and indexing their nulls buys nothing.
await c.query(`
  CREATE INDEX IF NOT EXISTS writer_clusters_landing_idx
  ON writer_clusters (landing_page_id)
  WHERE landing_page_id IS NOT NULL`);

const { rows } = await c.query(`
  SELECT count(*)::int total,
         count(landing_page_id)::int linked
    FROM writer_clusters`);
console.log(`writer_clusters: ${rows[0].total} rows, ${rows[0].linked} linked to a landing page`);

await c.end();
