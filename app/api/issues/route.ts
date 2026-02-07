import { NextResponse } from "next/server";
import Parser from "rss-parser";
import { z } from "zod";
import type { IssuesResponse, IssueItem } from "@/lib/types";

const QuerySchema = z.object({
  source: z.enum(["city", "provincial", "federal"]).default("city"),
});

// NOTE: City of Calgary "tagfeed" endpoints exist but sometimes block automated fetchers.
// This URL is commonly used for City of Calgary Newsroom tag feeds.
const CALGARY_RSS = "https://newsroom.calgary.ca/tagfeed/en/tags/transportation,city__news,city__release";
const FEDERAL_BILLS_RSS = "https://www.parl.ca/legisinfo/en/bills/rss";
const ALBERTA_BILLS_PAGE = "https://www.assembly.ab.ca/assembly-business/bills/daily-bill-activity";

const parser = new Parser();

function cleanSummary(html?: string) {
  if (!html) return undefined;
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

async function fromRss(url: string, source: "city" | "federal"): Promise<IssueItem[]> {
  const feed = await parser.parseURL(url);
  return (feed.items || []).slice(0, 12).map((it) => ({
    title: it.title || "Untitled",
    summary: cleanSummary((it as any).contentSnippet || (it as any).content || it.summary),
    link: it.link || url,
    publishedAt: it.pubDate || it.isoDate || undefined,
    source,
  }));
}

async function fromAlbertaPage(): Promise<IssueItem[]> {
  // Minimal “internet pull” MVP: grab the page HTML and extract some bill-related links.
  const res = await fetch(ALBERTA_BILLS_PAGE, { next: { revalidate: 3600 } });
  if (!res.ok) return [];
  const html = await res.text();

  // Naive extraction of links and titles that look like bills/activity entries.
  const items: IssueItem[] = [];
  const linkRe = /<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi;
  let m: RegExpExecArray | null;

  while ((m = linkRe.exec(html)) && items.length < 12) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    // Heuristic: keep items that mention "Bill" or "Act" or "Reading"
    if (!/\b(Bill|Act|Reading|Amend)\b/i.test(text)) continue;

    const abs = href.startsWith("http") ? href : `https://www.assembly.ab.ca${href.startsWith("/") ? "" : "/"}${href}`;
    items.push({
      title: text,
      summary: "Pulled from Legislative Assembly of Alberta daily bill activity page.",
      link: abs,
      source: "provincial",
    });
  }

  // If we didn’t find anything, at least return a single “source link”
  if (items.length === 0) {
    items.push({
      title: "View Alberta Daily Bill Activity",
      summary: "Official Legislative Assembly of Alberta page.",
      link: ALBERTA_BILLS_PAGE,
      source: "provincial",
    });
  }

  return items;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ source: url.searchParams.get("source") ?? "city" });
  if (!parsed.success) return NextResponse.json({ error: "Bad source" }, { status: 400 });

  const source = parsed.data.source;

  try {
    let items: IssueItem[] = [];
    if (source === "city") items = await fromRss(CALGARY_RSS, "city");
    if (source === "federal") items = await fromRss(FEDERAL_BILLS_RSS, "federal");
    if (source === "provincial") items = await fromAlbertaPage();

    const response: IssuesResponse = { source, items };
    return NextResponse.json(response);
  } catch (e: any) {
    return NextResponse.json({ error: "Failed to load issues", detail: String(e?.message ?? e) }, { status: 502 });
  }
}
