import { NextResponse } from "next/server";
import { z } from "zod";

const QuerySchema = z.object({
  name: z.string().min(3),
  riding: z.string().optional(),
});

const OP_BASE = "https://api.openparliament.ca";

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// OpenParliament returns some bilingual fields like { en, fr }
function pickEn(x: any): string | null {
  if (!x) return null;
  if (typeof x === "string") return x;
  if (typeof x === "object" && typeof x.en === "string") return x.en;
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    name: url.searchParams.get("name") ?? "",
    riding: url.searchParams.get("riding") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  const { name, riding } = parsed.data;

  // 1) Find politician by name
  const polRes = await fetch(
    `${OP_BASE}/politicians/?format=json&limit=20&name=${encodeURIComponent(name)}`,
    { headers: { Accept: "application/json" }, next: { revalidate: 3600 } }
  );

  if (!polRes.ok) {
    return NextResponse.json({ error: "OpenParliament lookup failed" }, { status: 502 });
  }

  const polJson = await polRes.json();
  const politicians: any[] = Array.isArray(polJson?.objects) ? polJson.objects : [];

  if (politicians.length === 0) {
    return NextResponse.json({ error: "No matching MP found." }, { status: 404 });
  }

  // Best match: exact-ish name + (if provided) try to match current riding name
  const targetName = norm(name);
  const targetRiding = riding ? norm(riding) : null;

  let politician =
    politicians.find((p) => norm(p?.name || "") === targetName) ||
    politicians.find((p) => norm(p?.name || "").includes(targetName)) ||
    politicians[0];

  if (targetRiding) {
    const ridingMatch = politicians.find((p) => {
      const r = p?.current_riding?.name;
      const ridingEn = typeof r === "object" ? r.en : r;
      if (!ridingEn) return false;
      return norm(ridingEn) === targetRiding;
    });
    if (ridingMatch) politician = ridingMatch;
  }

  const politicianUrl: string | null = politician?.url ?? null; // like "/politicians/firstname-lastname/"
  if (!politicianUrl) {
    return NextResponse.json({ error: "MP profile missing url." }, { status: 502 });
  }

  // 2) Get recent ballots (individual votes)
  const ballotsRes = await fetch(
    `${OP_BASE}/votes/ballots/?format=json&limit=8&politician=${encodeURIComponent(politicianUrl)}`,
    { headers: { Accept: "application/json" }, next: { revalidate: 1800 } }
  );

  if (!ballotsRes.ok) {
    return NextResponse.json({ error: "Failed to load ballots." }, { status: 502 });
  }

  const ballotsJson = await ballotsRes.json();
  const ballots: any[] = Array.isArray(ballotsJson?.objects) ? ballotsJson.objects : [];

  // 3) Pull vote details (title/date) for each ballot.vote_url
  const voteUrls = Array.from(
    new Set(
      ballots
        .map((b) => b?.vote_url)
        .filter((x) => typeof x === "string" && x.startsWith("/votes/"))
    )
  ).slice(0, 8);

  const voteDetailByUrl = new Map<string, any>();

  await Promise.all(
    voteUrls.map(async (v) => {
      const r = await fetch(`${OP_BASE}${v}?format=json`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 1800 },
      });
      if (!r.ok) return;
      const j = await r.json();
      voteDetailByUrl.set(v, j);
    })
  );

  const items = ballots
    .map((b) => {
      const vurl = b?.vote_url as string | undefined;
      const vd = vurl ? voteDetailByUrl.get(vurl) : null;

      // ballot field is usually "Yea", "Nay", "Paired", "Absent"
      const ballot = b?.ballot ?? null;

      const title = pickEn(vd?.description) ?? "Vote";
      const date = vd?.date ?? null;

        const result = vd?.result ?? null;

            return {
            title,
            date,
            vote: ballot,
            result, // ← THIS IS NEW
            vote_url: vurl ? `https://openparliament.ca${vurl}` : null,
            };


    })
    .filter((x) => x.vote_url); // keep clean

  return NextResponse.json({
    mp: {
      name: politician?.name ?? name,
      profile_url: `https://openparliament.ca${politicianUrl}`,
    },
    items,
  });
}
