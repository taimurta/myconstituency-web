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
  const office = (r: Representative) => (r.elected_office || "").toLowerCase();

  const isMunicipal = (r: Representative) =>
    /(mayor|councillor|alderman)/i.test(office(r));

  const isProvincial = (r: Representative) => {
  const o = office(r);
    return (
      /\b(mla|mpp|mna)\b/i.test(o) ||
      o.includes("member of the legislative assembly") ||
      o.includes("legislative assembly")
    );
  };

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

const PROVINCE_CODE_ALIASES: Record<string, string> = {
  AB: "AB",
  ALBERTA: "AB",
  BC: "BC",
  "BRITISH COLUMBIA": "BC",
  MB: "MB",
  MANITOBA: "MB",
  NB: "NB",
  "NEW BRUNSWICK": "NB",
  NL: "NL",
  "NEWFOUNDLAND AND LABRADOR": "NL",
  NS: "NS",
  "NOVA SCOTIA": "NS",
  NT: "NT",
  "NORTHWEST TERRITORIES": "NT",
  NU: "NU",
  NUNAVUT: "NU",
  ON: "ON",
  ONTARIO: "ON",
  PE: "PE",
  "PRINCE EDWARD ISLAND": "PE",
  QC: "QC",
  QUEBEC: "QC",
  SK: "SK",
  SASKATCHEWAN: "SK",
  YT: "YT",
  YUKON: "YT",
};

const LEGISLATURE_SET_NAME_BY_CODE: Record<string, string> = {
  AB: "Legislative Assembly of Alberta",
  BC: "Legislative Assembly of British Columbia",
  MB: "Legislative Assembly of Manitoba",
  NB: "Legislative Assembly of New Brunswick",
  NL: "Newfoundland and Labrador House of Assembly",
  NS: "Nova Scotia House of Assembly",
  NT: "Legislative Assembly of the Northwest Territories",
  ON: "Legislative Assembly of Ontario",
  PE: "Legislative Assembly of Prince Edward Island",
  QC: "Assemblée nationale du Québec",
  SK: "Legislative Assembly of Saskatchewan",
  YT: "Legislative Assembly of Yukon",
  NU: "Legislative Assembly of Nunavut",
};

const PROVINCE_NAME_BY_CODE: Record<string, string> = {
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

function normalizeProvinceCode(input?: string): string | null {
  const key = (input || "").replace(/\s+/g, " ").trim().toUpperCase();
  if (!key) return null;
  return PROVINCE_CODE_ALIASES[key] ?? null;
}


async function resolveLegislatureRepresentativesPath(provinceCode?: string) {
  const code = normalizeProvinceCode(provinceCode);
  if (!code) return null;

  const expectedName = LEGISLATURE_SET_NAME_BY_CODE[code];
  if (!expectedName) return null;

  const res = await fetch("https://represent.opennorth.ca/representative-sets/?format=json&limit=0", {
    headers: { Accept: "application/json" },
    next: { revalidate: 86400 },
  });
  if (!res.ok) return null;

  const json = await res.json();
  const objects: any[] = Array.isArray(json?.objects) ? json.objects : [];

  const match = objects.find(
    (s) => String(s?.name || "").toLowerCase() === expectedName.toLowerCase()
  );

  return (match?.related?.representatives_url as string | undefined) ?? null;
}

type PagedResponse<T> = {
  objects?: T[];
  meta?: { next?: string | null };
};

async function fetchAllRepresentatives(representativesPath: string): Promise<Representative[]> {
  const all: Representative[] = [];

  let nextUrl: string | null =
    `https://represent.opennorth.ca${representativesPath}?format=json&limit=500`;

  let guard = 0;

  while (nextUrl && guard < 25) {
    const res: Response = await fetch(nextUrl, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });

    if (!res.ok) break;

    const json: PagedResponse<Representative> = await res.json();
    const objects = Array.isArray(json.objects) ? json.objects : [];
    all.push(...objects);

    const rawNext = json.meta?.next;
    if (typeof rawNext === "string" && rawNext.length > 0) {
      nextUrl = rawNext.startsWith("http")
        ? rawNext
        : `https://represent.opennorth.ca${rawNext}`;
    } else {
      nextUrl = null;
    }

    guard += 1;
  }

  return all;
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



async function fetchPremier(provinceCode?: string) {
  const code = normalizeProvinceCode(provinceCode);
  if (!code) return null;

  // Find the right legislature representatives endpoint for that province
  const repsPath = await resolveLegislatureRepresentativesPath(code);
  if (!repsPath) return null;

  // Download all reps in that legislature (handles pagination)
  const objects = await fetchAllRepresentatives(repsPath);
  if (objects.length === 0) return null;

  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

  const isFalsePositiveRole = (r: string) => {
    // staff / office roles
    if (r.includes("to the premier")) return true;
    if (r.includes("premier's")) return true;
    if (r.includes("chief of staff")) return true;
    if (r.includes("principal secretary")) return true;
    if (r.includes("press secretary")) return true;
    if (r.includes("communications")) return true;
    if (r.includes("parliamentary secretary")) return true;
    if (r.includes("assistant")) return true;
    if (r.includes("advisor")) return true;
    if (r.includes("adviser")) return true;
    if (r.includes("staff")) return true;
    if (r.startsWith("deputy premier")) return true;
    return false;
  };

  const isActualPremierRole = (role: string) => {
    const r = normalize(role);
    if (!r) return false;
    if (isFalsePositiveRole(r)) return false;

    // English + French common patterns
    if (r === "premier") return true;
    if (r.startsWith("premier of ")) return true;
    if (r === "premier ministre") return true;
    if (r.startsWith("premier ministre")) return true;

    return false;
  };

  const getRoles = (rep: any): string[] =>
    Array.isArray(rep?.extra?.roles)
      ? rep.extra.roles.filter((x: any) => typeof x === "string")
      : [];

  // 1) Best case: role is explicitly marked
  const byRole = objects.find((rep: any) => getRoles(rep).some(isActualPremierRole));
  if (byRole) return byRole as any;

  // 2) Fallback: some provinces mark it in offices (e.g., "Premier's Office")
  const byOffice = objects.find((rep: any) =>
    Array.isArray(rep?.offices) &&
    rep.offices.some((o: any) =>
      /premier'?s office|bureau du premier ministre/i.test(String(o?.postal || ""))
    )
  );
  if (byOffice) return byOffice as any;

  // If Represent doesn't label it for that province, we can’t reliably infer it
  return null;
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

// --- Hardcoded reps (fallbacks / special cases) ---
const HARDCODED_PREMIER_BC: Representative = {
  name: "David Eby",
  elected_office: "Premier",
  district_name: "British Columbia",
  party_name: "New Democratic Party",
  url: "https://www2.gov.bc.ca/gov/content/government/ministries-organizations/premier",
  source_url: "https://www2.gov.bc.ca/gov/content/government/ministries-organizations/premier",
  // photo_url optional; leave blank unless you have a reliable one
};

const HARDCODED_PREMIER_SK: Representative = {
  name: "Scott Moe",
  elected_office: "Premier",
  district_name: "Saskatchewan",
  party_name: "Saskatchewan Party",
  url: "https://www.saskatchewan.ca/government/government-structure/premier-and-cabinet/premier",
  source_url: "https://www.saskatchewan.ca/government/government-structure/premier-and-cabinet/premier",
};

const HARDCODED_SANTA: Representative = {
  name: "Santa Claus",
  elected_office: "Santa",
  district_name: "North Pole",
  party_name: "Independent",
  email: "santa@northpole.ca", // optional fun touch; remove if you don't want an email
  url: "https://www.canadapost-postescanada.ca/cpc/en/our-company/write-letter-to-santa.page",
  source_url: "https://www.canadapost-postescanada.ca/cpc/en/our-company/write-letter-to-santa.page",
};

function injectHardcodedPremierIfNeeded(buckets: { provincial: Representative[] }, provinceCode?: string) {
  const code = normalizeProvinceCode(provinceCode || undefined);

  if (code === "BC") {
    const exists = buckets.provincial.some(
      (r) => (r.name || "").toLowerCase() === HARDCODED_PREMIER_BC.name.toLowerCase()
    );
    if (!exists) buckets.provincial.push(HARDCODED_PREMIER_BC);
  }

  if (code === "SK") {
    const exists = buckets.provincial.some(
      (r) => (r.name || "").toLowerCase() === HARDCODED_PREMIER_SK.name.toLowerCase()
    );
    if (!exists) buckets.provincial.push(HARDCODED_PREMIER_SK);
  }
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
  const p = postal.replace(/\s+/g, "").toUpperCase();
  if (p === "H0H0H0") {
    buckets.municipal.push(HARDCODED_SANTA);
  }
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
    district_name: PROVINCE_NAME_BY_CODE[normalizeProvinceCode(provinceCode) ?? ""] ?? (provinceCode ?? ""),
  });
}

if (primeMinister && !buckets.federal.some(r => (r.name || "").toLowerCase() === (primeMinister.name || "").toLowerCase())) {
  buckets.federal.push({
    ...primeMinister,
    elected_office: "Prime Minister",
    district_name: "Canada",
  });
}

injectHardcodedPremierIfNeeded(buckets, provinceCode);
  
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
  const p = postal.replace(/\s+/g, "").toUpperCase();
  if (p === "H0H0H0") {
    buckets.municipal.push(HARDCODED_SANTA);
  } 
  // Add Premier + Prime Minister (province/nation-wide roles)
  const provinceCode = data.province ?? undefined;
injectHardcodedPremierIfNeeded(buckets, provinceCode);
  
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
      district_name: PROVINCE_NAME_BY_CODE[normalizeProvinceCode(provinceCode) ?? ""] ?? (provinceCode ?? ""),
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
