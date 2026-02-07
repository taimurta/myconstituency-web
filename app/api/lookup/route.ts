import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizePostal, isLikelyCanadianPostal } from "@/lib/postal";
import type { LookupResponse, Representative } from "@/lib/types";

const QuerySchema = z.object({
  postal: z.string().min(3),
});

type RepresentPostcodeResponse = {
  postal_code: string;
  city: string | null;
  province: string | null;
  representatives_centroid?: Representative[];
  representatives_concordance?: Representative[];
};

function bucket(reps: Representative[]) {
  const municipal = reps.filter(r => (r.elected_office || "").toLowerCase().includes("councillor") || (r.elected_office || "").toLowerCase().includes("alderman") || (r.elected_office || "").toLowerCase().includes("mayor"));
  const provincial = reps.filter(r => (r.elected_office || "").toLowerCase().includes("mla") || (r.elected_office || "").toLowerCase().includes("mpp") || (r.elected_office || "").toLowerCase().includes("mna"));
  const federal = reps.filter(r => (r.elected_office || "").toLowerCase().includes("mp"));
  return { municipal, provincial, federal };
}

function dedupeByName(reps: Representative[]) {
  const seen = new Set<string>();
  const out: Representative[] = [];
  for (const r of reps) {
    const key = (r.name || "").toLowerCase() + "|" + (r.elected_office || "").toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}
async function fetchPrimeMinister() {
  const res = await fetch(
    "https://represent.opennorth.ca/representatives/house-of-commons/?limit=500",
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    }
  );
  if (!res.ok) return null;

  const json = await res.json();
  const objects: Representative[] = Array.isArray(json?.objects) ? json.objects : [];

  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

  const isActualPMRole = (role: string) => {
    const r = normalize(role);

    // must start with "prime minister" (allows "prime minister of canada ..." etc)
    if (!r.startsWith("prime minister")) return false;

    // reject common false positives
    if (r.includes("parliamentary secretary")) return false; // e.g. "Parliamentary Secretary to the Prime Minister"
    if (r.includes("to the prime minister")) return false;
    if (r.startsWith("deputy prime minister")) return false;

    return true;
  };

  return (
    objects.find(
      (r: any) => Array.isArray(r?.extra?.roles) && r.extra.roles.some(isActualPMRole)
    ) ?? null
  );
}



async function fetchPremier(provinceCode: string | undefined) {
  if (provinceCode !== "AB") return null;

  const res = await fetch("https://represent.opennorth.ca/representatives/alberta-legislature/?limit=500", {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) return null;

  const json = await res.json();
  const objects: Representative[] = Array.isArray(json?.objects) ? json.objects : [];

  // Premier is also typically a ROLE in extra.roles
  return (
    objects.find((r: any) => Array.isArray(r?.extra?.roles) && r.extra.roles.some((x: string) => /premier/i.test(x))) ||
    null
  );
}


export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ postal: url.searchParams.get("postal") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Missing postal" }, { status: 400 });

  const postal = normalizePostal(parsed.data.postal);
  if (!isLikelyCanadianPostal(postal)) {
    return NextResponse.json({ error: "That doesn’t look like a Canadian postal code (format: A1A1A1)." }, { status: 400 });
  }

  const endpoint = `https://represent.opennorth.ca/postcodes/${encodeURIComponent(postal)}/`;
  const res = await fetch(endpoint, {
    headers: { "Accept": "application/json" },
    // Cache at the edge/server for 30 minutes to respect rate limits.
    next: { revalidate: 1800 },
  });

  if (!res.ok) {
    return NextResponse.json({ error: "Lookup failed", status: res.status }, { status: 502 });
  }

  const data = (await res.json()) as RepresentPostcodeResponse;

  const centroid = Array.isArray(data.representatives_centroid) ? data.representatives_centroid : [];
  const concord = Array.isArray(data.representatives_concordance) ? data.representatives_concordance : [];

  // Prefer centroid, but include concordance as fallback.
  const combined = dedupeByName([...centroid, ...concord]);

  const buckets = bucket(combined);

  // Add Premier + Prime Minister (province/nation-wide roles)
const provinceCode = data.province ?? undefined;

const [premier, primeMinister] = await Promise.all([
  fetchPremier(provinceCode),
  fetchPrimeMinister(),
]);

if (premier) {
  const exists = buckets.provincial.some(
    (r) => (r.name || "").toLowerCase() === (premier.name || "").toLowerCase()
  );

  if (!exists) {
    buckets.provincial.push({
      ...premier,
      elected_office: "Premier",
      district_name: "Alberta",
    });
  }
}

if (primeMinister) {
  const exists = buckets.federal.some(
    (r) => (r.name || "").toLowerCase() === (primeMinister.name || "").toLowerCase()
  );

  if (!exists) {
    buckets.federal.push({
      ...primeMinister,
      elected_office: "Prime Minister",
      district_name: "Canada",
    });
  }
}


  const response: LookupResponse = {
    postal,
    city: data.city ?? undefined,
    province: data.province ?? undefined,
    reps: {
      municipal: buckets.municipal,
      provincial: buckets.provincial,
      federal: buckets.federal,
    },
    note:
      "Postal codes can sometimes map to multiple districts. If anything looks off, add an address-based confirmation step (geocoding) for 100% accuracy.",
  };

  return NextResponse.json(response);
}
