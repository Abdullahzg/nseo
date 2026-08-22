// Source prospects from the people who write about our competitors.
//
// The existing discovery (`runBacklinkTargets`) finds LINKABLE PAGES — roundups and listicles where an
// "AI image generator" slot already exists. That is the right first instinct and it has a ceiling: those
// pages are finite, every competitor is emailing the same ones, and the campaign runs out of them.
//
// This is the other supply. A competitor's own blog is written by named people who cover this space
// professionally, and who publish on their own sites and elsewhere too. They are warmer than a cold
// roundup owner because the subject is already their beat, and there are far more of them.
//
// Why it matters for the 50-links-a-week target specifically: at a 0.4% win rate the maths says volume
// cannot get there (~12,500 sends against a ~3,430/week ceiling), so the rate has to move. Prospect
// quality is the other half of that, alongside the pitch — a writer who covers AI image tools is a
// different proposition from whoever happens to own a listicle.
//
// Every author found goes through the normal path: real authors/domains/articles rows, then the existing
// enrichment cascade, which now keeps X, LinkedIn and contact forms when it cannot find an email. So a
// discovered author is never a dead end.

import PQueue from "p-queue";
import { supabaseAdmin } from "@/lib/db/supabase";
import {
  upsertDomain, upsertAuthor, upsertArticle, linkArticleAuthor,
  linkAuthorsToCampaign, addWorkflowProspects, isSuppressed,
} from "@/lib/db/queries";
import { fetchRaw } from "@/lib/indexing/fetchRendered";
import { extractByline, publicationName } from "./authorName";
import { isLikelyPersonName, cleanAuthorName } from "@/lib/enrich/personFilter";
import { topCompetitors } from "@/lib/seo-agents/serpCompetitors";
import type { BacklinkCampaign } from "./pipeline";

const POST_CONCURRENCY = 4;
/** Posts to read per competitor. Enough to find their regular writers, not their whole archive. */
const MAX_POSTS_PER_SITE = 25;
/** Only recent-ish posts: a byline from 2019 has probably moved on, and a bounce costs reputation. */
const MAX_SITEMAP_SCAN = 400;

export interface CompetitorAuthorReport {
  competitors: string[];
  postsRead: number;
  authorsFound: number;
  saved: number;
  skipped: number;
  notes: string[];
}

/** Paths that look like a blog index or post on almost every marketing site. */
const BLOG_HINT = /\/(blog|blogs|articles|resources|insights|news|guides|learn)(\/|$)/i;

/**
 * Find a competitor's blog post URLs.
 *
 * Sitemap first because it is the honest, complete list and costs one request. A site that publishes a
 * sitemap has told us exactly what it has; guessing paths against a SPA gets 200s for everything.
 */
async function findBlogPosts(domain: string, notes: string[]): Promise<string[]> {
  const roots = [`https://${domain}/sitemap.xml`, `https://www.${domain}/sitemap.xml`];
  const seen = new Set<string>();

  for (const root of roots) {
    const res = await fetchRaw(root).catch(() => null);
    if (!res?.ok || !res.html || !/<(urlset|sitemapindex)/i.test(res.html)) continue;

    const locs = [...res.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    // A sitemap index nests more sitemaps. Only follow the ones whose own URL suggests content, or a big
    // site sends us through product and category maps first and the budget is gone before any posts.
    if (/<sitemapindex/i.test(res.html)) {
      // Prefer children whose own URL names content, but fall back to the first few of ANY name.
      // Filtering on the name alone was too strict and returned nothing on real sites: invideo.io and
      // creatify.ai both nest by locale (sitemap_en.xml), which carries no content hint, so every child
      // was excluded and the crawl read zero posts while reporting "no blog URLs in a sitemap".
      const named = locs.filter((l) => BLOG_HINT.test(l) || /post|article/i.test(l));
      const children = (named.length ? named : locs).slice(0, 6);
      for (const sm of children) {
        const sub = await fetchRaw(sm).catch(() => null);
        if (!sub?.ok || !sub.html) continue;
        const urls = [...sub.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
        const hinted = urls.filter((u) => BLOG_HINT.test(u));
        for (const u of (hinted.length ? hinted : urls)) {
          if (seen.size < MAX_SITEMAP_SCAN) seen.add(u);
        }
      }
    } else {
      const hinted = locs.filter((u) => BLOG_HINT.test(u));
      for (const u of (hinted.length ? hinted : locs)) {
        if (seen.size < MAX_SITEMAP_SCAN) seen.add(u);
      }
    }
    if (seen.size) break;
  }

  if (!seen.size) notes.push(`${domain}: no readable sitemap — skipped rather than guessing paths.`);
  // Later entries in a sitemap are usually the newer posts, so take from the end.
  return [...seen].slice(-MAX_POSTS_PER_SITE);
}

/**
 * Pull the named writers off a competitor's blog and save them as prospects.
 *
 * `competitors` can be given explicitly, or discovered from the campaign's own topic via the SERP — the
 * sites outranking us for our keyword are by definition the ones whose writers cover our space.
 */
export async function runCompetitorAuthors(
  bl: BacklinkCampaign,
  opts: { competitors?: string[]; maxPerSite?: number } = {},
): Promise<CompetitorAuthorReport> {
  const notes: string[] = [];
  let competitors = (opts.competitors ?? []).map((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase()).filter(Boolean);

  if (!competitors.length) {
    const found = await topCompetitors(bl.topic || "ai image generator", { limit: 5 }).catch(() => null);
    if (!found?.length) {
      notes.push("No competitors given and the SERP lookup returned nothing (SERPER_API_KEY may be unset).");
      return { competitors: [], postsRead: 0, authorsFound: 0, saved: 0, skipped: 0, notes };
    }
    competitors = found.map((c) => c.domain);
    notes.push(`Competitors from the SERP for "${bl.topic}": ${competitors.join(", ")}.`);
  }

  // Authors already in this campaign, so a re-run adds rather than duplicates.
  const { data: existing } = await supabaseAdmin
    .from("backlink_prospects").select("prospect_url").eq("backlink_campaign_id", bl.id);
  const seenUrls = new Set((existing ?? []).map((r: any) => r.prospect_url));

  const queue = new PQueue({ concurrency: POST_CONCURRENCY });
  const authorIds: string[] = [];
  // One row per (author, post). A writer with six posts should be ONE prospect, not six.
  const claimedAuthors = new Map<string, string>();
  let postsRead = 0, authorsFound = 0, saved = 0, skipped = 0;

  for (const domain of competitors) {
    if (await isSuppressed(domain).catch(() => false)) {
      notes.push(`${domain} is suppressed — skipped.`);
      continue;
    }
    const posts = await findBlogPosts(domain, notes);
    if (!posts.length) continue;

    await Promise.all(posts.map((url) => queue.add(async () => {
      if (seenUrls.has(url)) { skipped++; return; }
      const raw = await fetchRaw(url).catch(() => null);
      postsRead++;
      if (!raw?.ok || !raw.html) { skipped++; return; }

      const byline = cleanAuthorName(extractByline(raw.html));
      // A pseudo-author ("Acme Editorial") is fine for a roundup owner, where the page is the prospect.
      // Here the PERSON is the prospect, so an unnamed post is not one — it would produce an author with
      // no name to search for and no plausible email.
      if (!byline || !isLikelyPersonName(byline, publicationName(domain))) { skipped++; return; }

      const key = `${domain}|${byline.toLowerCase()}`;
      const already = claimedAuthors.get(key);

      try {
        const dom = await upsertDomain(domain, { name: publicationName(domain) });
        const author = already
          ? { id: already }
          : await upsertAuthor({ full_name: byline, primary_domain_id: dom.id, source: "competitor-blog", role: "writer" });
        const article = await upsertArticle({ url_canonical: url, title: raw.html.match(/<title[^>]*>([^<]{2,140})</i)?.[1]?.trim() || url, domain_id: dom.id });
        await linkArticleAuthor(article.id, author.id);

        if (!already) {
          claimedAuthors.set(key, author.id);
          authorIds.push(author.id);
          authorsFound++;
          await supabaseAdmin.from("backlink_prospects").upsert({
            backlink_campaign_id: bl.id, author_id: author.id, domain,
            prospect_url: url,
            angle: `Writes about this space on ${domain} — their own beat, not a roundup slot.`,
            stage: "found", updated_at: new Date().toISOString(),
          }, { onConflict: "backlink_campaign_id,author_id", ignoreDuplicates: true });
          saved++;
        }
      } catch { skipped++; }
    })));
  }

  if (authorIds.length) {
    await linkAuthorsToCampaign(bl.campaign_id, authorIds).catch(() => {});
    await addWorkflowProspects(bl.workflow_id, authorIds).catch(() => {});
  }

  notes.push(
    `${authorsFound} named writer${authorsFound === 1 ? "" : "s"} from ${postsRead} posts across ` +
    `${competitors.length} competitor site${competitors.length === 1 ? "" : "s"}.`,
  );
  if (skipped > postsRead / 2) {
    notes.push("Over half the posts had no usable byline — many marketing blogs publish unsigned, so this is normal rather than a failure.");
  }

  return { competitors, postsRead, authorsFound, saved, skipped, notes };
}
