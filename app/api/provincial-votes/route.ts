import { NextResponse } from "next/server";
import { z } from "zod";

// MVP shape that your UI can render.
// We’ll make province-specific parsers step-by-step, starting with Alberta.
const QuerySchema = z.object({
  province: z.string().optional(), // "AB", "BC", "SK", "ON"
  district: z.string().optional(), // riding/district name
  name: z.string().optional(),     // MLA name
});

type VoteItem = {
  title: string;
  date?: string | null;
  passed?: boolean | null;     // we’ll fill when available
  vote?: "Yes" | "No" | "Absent" | "Paired" | "Unknown";
  vote_url?: string | null;
};

function normalizeProvince(input?: string) {
  const p = (input || "").trim().toUpperCase();
  if (!p) return null;
  if (p === "ALBERTA") return "AB";
  if (p === "BRITISH COLUMBIA") return "BC";
  if (p === "SASKATCHEWAN") return "SK";
  if (p === "ONTARIO") return "ON";
  // already code?
  if (["AB", "BC", "SK", "ON"].includes(p)) return p;
  return p; // let it through so you can debug
}

// For now: return “recent official vote docs” per province.
// Next step (after this works) is parsing per-MLA vote lines from those docs.
async function fetchProvincialVoteDocs(provinceCode: string): Promise<VoteItem[]> {
  // OFFICIAL SOURCES (votes/proceedings pages)
  // Alberta: Votes & Proceedings database
  // SK: Minutes (Votes)
  // BC: Votes & Proceedings
  // ON: House documents / Votes & Proceedings

  if (provinceCode === "AB") {
    // Alberta Votes & Proceedings landing page (MVP: link only)
    return [
      {
        title: "Votes and Proceedings (Legislative Assembly of Alberta)",
        date: null,
        passed: null,
        vote: "Unknown",
        vote_url: "https://www.assembly.ab.ca/assembly-business/assembly-records/votes-and-proceedings",
      },
    ];
  }

  if (provinceCode === "SK") {
    return [
      {
        title: "Minutes (Votes) (Legislative Assembly of Saskatchewan)",
        date: null,
        passed: null,
        vote: "Unknown",
        vote_url: "https://www.legassembly.sk.ca/legislative-business/minutes-votes/",
      },
    ];
  }

  if (provinceCode === "BC") {
    return [
      {
        title: "Votes and Proceedings (Legislative Assembly of British Columbia)",
        date: null,
        passed: null,
        vote: "Unknown",
        vote_url: "https://leg.bc.ca/learn/discover-your-legislature/house-documents/votes-and-proceedings",
      },
    ];
  }

  if (provinceCode === "ON") {
    return [
      {
        title: "Votes and Proceedings (Legislative Assembly of Ontario)",
        date: null,
        passed: null,
        vote: "Unknown",
        vote_url: "https://www.ola.org/en/legislative-business/house-documents",
      },
    ];
  }

  return [];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    province: url.searchParams.get("province") ?? undefined,
    district: url.searchParams.get("district") ?? undefined,
    name: url.searchParams.get("name") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const provinceCode = normalizeProvince(parsed.data.province);
  if (!provinceCode) {
    return NextResponse.json({ error: "Missing province" }, { status: 400 });
  }

  const items = await fetchProvincialVoteDocs(provinceCode);

  // Response matches your federal-votes shape enough to render
  return NextResponse.json({
    province: provinceCode,
    member: {
      name: parsed.data.name ?? null,
      district: parsed.data.district ?? null,
    },
    items,
    note:
      "Provincial voting data is published by each legislature. Next step is parsing official Votes & Proceedings to show per-MLA Yes/No.",
  });
}