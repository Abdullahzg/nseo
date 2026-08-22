// Best-effort byline extraction for a backlink prospect page. Backlink targets are often
// roundups/listicles; if we can find a real author byline we outreach to a person, otherwise we
// fall back to a "<Publication> Editorial" pseudo-author so the record still fits the existing
// authors schema and enrichment can try to find a real contact.
import * as cheerio from "cheerio";
import { isLikelyPersonName } from "@/lib/enrich/personFilter";

export function extractByline(html: string): string | null {
  const $ = cheerio.load(html);
  const raw = [
    $('meta[name="author"]').attr("content"),
    $('meta[property="article:author"]').attr("content"),
    $('[rel="author"]').first().text(),
    $('[itemprop="author"]').first().text(),
    $('.author-name, .byline__name, .post-author, .author, .byline').first().text(),
  ];
  for (const c of raw) {
    const name = (c || "")
      .replace(/^\s*by\s+/i, "")
      .split(/[|,·—\n]/)[0]
      .replace(/\s+/g, " ")
      .trim();
    if (name && isLikelyPersonName(name)) return name;
  }
  return null;
}

/** "cnet.com" -> "CNET", "smashingmagazine.com" -> "Smashingmagazine". */
export function publicationName(domain: string): string {
  const core = domain.replace(/^www\./, "").split(".")[0];
  return core.length <= 4 ? core.toUpperCase() : core.charAt(0).toUpperCase() + core.slice(1);
}
