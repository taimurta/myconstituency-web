import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizePostal, isLikelyCanadianPostal } from "@/lib/postal";
import type { LookupResponse, Representative } from "@/lib/types";

const QuerySchema = z.object({
  postal: z.string().min(3),
});

const PROVINCE_NAME: Record<string, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};


type RepresentPostcodeResponse = {
  postal_code: string;
  city: string | null;
  province: string | null;
  representatives_centroid?: Representative[];
  representatives_concordance?: Representative[];
};

function bucket(reps: Representative[]) {
  const office = (r: Representative) => (r.elected_office || "").toLowerCase();

  const isMunicipal = (r: Representative) =>
    /(mayor|councillor|alderman)/i.test(office(r));

  const isProvincial = (r: Representative) =>
    /\b(mla|mpp|mna)\b/i.test(office(r));

  const isFederal = (r: Representative) =>
    /\bmp\b/i.test(office(r)); // ✅ matches MP only, not MPP

  const municipal = reps.filter(isMunicipal);
  const provincial = reps.filter(isProvincial);
  const federal = reps.filter(isFederal);

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

async function findProvJurisdictionSlug(provinceCode?: string) {
  if (!provinceCode) return null;

  const provinceName = PROVINCE_NAME[provinceCode];
  if (!provinceName) return null;

  const res = await fetch("https://represent.opennorth.ca/jurisdictions/?limit=0", {
    headers: { Accept: "application/json" },
    next: { revalidate: 86400 }, // daily
  });
  if (!res.ok) return null;

  const json = await res.json();
  const objects: any[] = Array.isArray(json?.objects) ? json.objects : [];

  // Heuristic: find a legislature/assembly jurisdiction that matches the province name
  const pick = objects.find((j) => {
    const name = (j?.name || "").toLowerCase();
    return (
      name.includes(provinceName.toLowerCase()) &&
      (name.includes("legislative") || name.includes("legislature") || name.includes("assembly"))
    );
  });

  return pick?.slug ?? null;
}


async function geocodePostalCanada(postal: string) {
  const p = postal.replace(/\s+/g, "").toUpperCase();
  const spaced = p.length === 6 ? `${p.slice(0, 3)} ${p.slice(3)}` : p;

  // GeoGratis Canadian Geocoder (postal code search)
  // It returns candidates with location coordinates.
  const url =
    "https://geogratis.gc.ca/services/geolocation/en/locate?q=" +
    encodeURIComponent(spaced);

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 * 60 * 24 * 30 },
  });

  if (!res.ok) {
    return { ok: false as const, status: res.status, url };
  }

  const json = await res.json();
  const candidates = Array.isArray(json) ? json : json?.items || json?.results || [];

  // Try a few possible shapes, because responses can vary
  const first = candidates?.[0];
  const coords =
    first?.geometry?.coordinates ||
    first?.location?.coordinates ||
    first?.location ||
    null;

  if (!coords || coords.length < 2) {
    return { ok: false as const, status: 200, url, empty: true };
  }

  // GeoJSON is [lon, lat]
  const lon = Number(coords[0]);
  const lat = Number(coords[1]);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false as const, status: 200, url, badCoords: true };
  }

  return { ok: true as const, lat, lon, url };
}

async function fetchRepsByPoint(lat: number, lon: number) {
  const endpoint = `https://represent.opennorth.ca/representatives/?point=${lat},${lon}`;

  const res = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    next: { revalidate: 1800 }, // 30 minutes
  });

  if (!res.ok) {
    return { ok: false as const, status: res.status, endpoint };
  }

  const json = await res.json();
  const objects = Array.isArray(json?.objects) ? json.objects : [];

  return { ok: true as const, objects, endpoint };
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
  // Accept both "AB" and "Alberta" just in case
  const p = (provinceCode || "").trim().toUpperCase();
  const isAB = p === "AB" || p === "ALBERTA";
  if (!isAB) return null;

  const res = await fetch(
    "https://represent.opennorth.ca/representatives/alberta-legislature/?limit=500",
    {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    }
  );
  if (!res.ok) return null;

  const json = await res.json();
  const objects: Representative[] = Array.isArray(json?.objects) ? json.objects : [];

  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

  const isFalsePositive = (r: string) => {
    // common “to the premier” / staff roles
    if (r.includes("to the premier")) return true;
    if (r.includes("premier's")) return true; // e.g., "Premier's Chief of Staff"
    if (r.includes("chief of staff")) return true;
    if (r.includes("principal secretary")) return true;
    if (r.includes("press secretary")) return true;
    if (r.includes("communications")) return true;
    if (r.includes("parliamentary secretary")) return true;
    if (r.includes("assistant")) return true;
    if (r.includes("advisor")) return true;
    if (r.includes("adviser")) return true;
    if (r.includes("staff")) return true;

    return false;
  };

  const isActualPremierRole = (role: string) => {
    const r = normalize(role);

    // reject obvious false positives early
    if (isFalsePositive(r)) return false;

    // reject deputy premier
    if (r.startsWith("deputy premier")) return false;

    // Accept:
    // - "Premier"
    // - "Premier of Alberta"
    // - "Premier (something)" (rare)
    // But require it to start with "premier"
    if (!r.startsWith("premier")) return false;

    return true;
  };

  const getRoles = (rep: any): string[] =>
    Array.isArray(rep?.extra?.roles) ? rep.extra.roles.filter((x: any) => typeof x === "string") : [];

  // Strong preference: exact “Premier of Alberta” if present
  const exact = objects.find((rep: any) => {
    const roles = getRoles(rep).map(normalize);
    return roles.includes("premier of alberta");
  });
  if (exact) return exact as any;

  // Next best: anything that passes the strict filter above
  return (
    objects.find((rep: any) => getRoles(rep).some(isActualPremierRole)) ?? null
  );
}


function provinceFromPostal(postal: string): string | undefined {
  const c = (postal.replace(/\s+/g, "").toUpperCase()[0] ?? "");

  // Canada Post forward sortation area (FSA) first-letter mapping (coarse, but works for province)
  if (c === "A") return "NL";
  if (c === "B") return "NS";
  if (c === "C") return "PE";
  if (c === "E") return "NB";
  if (c === "G" || c === "H" || c === "J") return "QC";
  if (c === "K" || c === "L" || c === "M" || c === "N" || c === "P") return "ON";
  if (c === "R") return "MB";
  if (c === "S") return "SK";
  if (c === "T") return "AB";
  if (c === "V") return "BC";
  if (c === "Y") return "YT";
  if (c === "X") return undefined; // NT/NU are ambiguous by letter alone

  return undefined;
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


if (res.status === 404) {
 
  
  const geo = await geocodePostalCanada(postal);

if (!geo.ok) {
  return NextResponse.json(
    { error: "We couldn’t find that postal code.", debug: { step: "geocode", geo, postal } },
    { status: 404 }
  );
}

const reps = await fetchRepsByPoint(geo.lat, geo.lon);


  if (!reps.ok) {
    return NextResponse.json(
      {
        error: "We couldn’t find that postal code.",
        debug: {
          step: "represent_point_lookup_failed",
          reps,
          geo,
          postal,
        },
      },
      { status: 404 }
    );
  }

  if (reps.objects.length === 0) {
    return NextResponse.json(
      {
        error: "We couldn’t find that postal code.",
        debug: {
          step: "represent_point_lookup_empty",
          endpoint: reps.endpoint,
          geo,
          postal,
        },
      },
      { status: 404 }
    );
  }

  // ✅ If we got here, fallback succeeded:
  const combined = dedupeByName(reps.objects);
  const buckets = bucket(combined);

  // Add Premier + Prime Minister for geo fallback too
const provinceCode = provinceFromPostal(postal);

const [premier, primeMinister] = await Promise.all([
  fetchPremier(provinceCode),
  fetchPrimeMinister(),
]);

if (premier && !buckets.provincial.some(r => (r.name || "").toLowerCase() === (premier.name || "").toLowerCase())) {
  buckets.provincial.push({
    ...premier,
    elected_office: "Premier",
    district_name: "Alberta",
  });
}

if (primeMinister && !buckets.federal.some(r => (r.name || "").toLowerCase() === (primeMinister.name || "").toLowerCase())) {
  buckets.federal.push({
    ...primeMinister,
    elected_office: "Prime Minister",
    district_name: "Canada",
  });
}

  
  return NextResponse.json({
    postal,
    reps: {
      municipal: buckets.municipal,
      provincial: buckets.provincial,
      federal: buckets.federal,
    },
    note:
      "This must be a new neighbourhood. We couldn’t find that exact postal code, but here’s the closest match based on location.",
  });
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
