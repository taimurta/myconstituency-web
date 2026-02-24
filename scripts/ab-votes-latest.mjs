// scripts/ab-votes-latest.mjs
import process from "node:process";

const INDEX_URL =
  "https://www.assembly.ab.ca/assembly-business/assembly-records/votes-and-proceedings";

function norm(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
function normLower(s) {
  return norm(s).toLowerCase();
}
function lastNameOf(fullName) {
  const parts = norm(fullName).split(" ");
  return parts.length ? parts[parts.length - 1] : "";
}

function extractLatestVpPdfUrl(html) {
  // grab pdf links
  const matches = Array.from(
    html.matchAll(/href\s*=\s*["']([^"' ]+\.pdf)["']/gi)
  ).map((m) => m[1]);

  const toAbs = (href) => {
    if (href.startsWith("http")) return href;
    if (href.startsWith("//")) return `https:${href}`;
    if (href.startsWith("/")) return `https://www.assembly.ab.ca${href}`;
    return `https://www.assembly.ab.ca/${href}`;
  };

  // normalize &amp; and slashes
  const abs = matches
    .map(toAbs)
    .map((u) => u.replace(/&amp;/g, "&"))
    .map((u) => u.replace(/\\/g, "/"));

  // filter to likely Votes & Proceedings PDFs (VP)
  const vp = abs.filter((u) => {
    const l = u.toLowerCase();
    return (
      l.includes("docs.assembly.ab.ca") &&
      (l.includes("/vp/") || l.includes("_vp") || l.includes("houserecords"))
    );
  });

  // pick latest by YYYYMMDD in filename if present
  const withDate = vp
    .map((u) => {
      const m = u.match(/(\d{8})_\d{4}_\d{2}_vp\.pdf/i);
      return { u, date: m ? Number(m[1]) : 0 };
    })
    .sort((a, b) => b.date - a.date);

  return withDate[0]?.u || vp[0] || null;
}

async function pdfBufferToText(buf) {
  // IMPORTANT: this runs in plain Node, not Next bundler
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) });
  const pdf = await loadingTask.promise;

  let out = "";
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const strings = content.items
      .map((it) => (typeof it?.str === "string" ? it.str : ""))
      .filter(Boolean);
    out += strings.join(" ") + "\n";
  }
  return out.trim();
}

function extractVotesForMla(pdfText, mlaName, ridingMaybe) {
  const text = norm(pdfText);

  const targetLast = normLower(lastNameOf(mlaName));
  if (!targetLast) return [];

  const escapedLast = targetLast.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // If riding is given, Alberta sometimes disambiguates as "Smith (Brooks-Medicine Hat)"
  // We match either "Smith" OR "Smith (riding...)"
  const riding = normLower(ridingMaybe || "");
  const reName = riding
    ? new RegExp(`\\b${escapedLast}\\b\\s*\\(.*?${riding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*?\\)`, "i")
    : new RegExp(`\\b${escapedLast}\\b`, "i");

  const items = [];

  const reDivision =
    /For the motion:?\s*(.*?)\s*Against the motion:?\s*(.*?)(?=(?:For the motion:?)|$)/gis;

  let m;
  while ((m = reDivision.exec(text)) !== null) {
    const forBlock = norm(m[1] || "");
    const againstBlock = norm(m[2] || "");

    const votedYes = reName.test(normLower(forBlock));
    const votedNo = reName.test(normLower(againstBlock));

    let vote = "Unknown";
    if (votedYes && !votedNo) vote = "Yes";
    if (votedNo && !votedYes) vote = "No";
    if (vote === "Unknown") continue;

    // Title heuristic: look back a bit before this division starts
    const startIndex = m.index;
    const before = text.slice(Math.max(0, startIndex - 900), startIndex);

    let title = "Vote";
    const titleMatch = before.match(
      /(Bill\s+[A-Z]\-?\d+.*?|Bill\s+\d+.*?|Opposition Motion.*?|Government Motion.*?|Motion.*?|Second Reading.*?|Third Reading.*?)(?=\s{2,}|$)/i
    );
    if (titleMatch?.[1]) title = norm(titleMatch[1]);

    // Date heuristic near top
    let date = null;
    const topSlice = text.slice(0, 2500);
    const dateMatch = topSlice.match(
      /(Monday|Tuesday|Wednesday|Thursday|Friday),\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}/
    );
    if (dateMatch?.[0]) date = dateMatch[0];

    // Passed heuristic (best-effort)
    let passed = null;
    const around = text
      .slice(Math.max(0, startIndex - 600), Math.min(text.length, startIndex + 600))
      .toLowerCase();

    if (around.includes("motion was agreed") || around.includes("carried")) passed = true;
    if (around.includes("motion was defeated") || around.includes("negatived") || around.includes("not agreed"))
      passed = false;

    items.push({ title, date, vote, passed });
  }

  return items;
}

function getArg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return "";
  return process.argv[i + 1] || "";
}

async function main() {
  const name = getArg("--name");
  const riding = getArg("--riding");
  const debug = getArg("--debug") === "1";

  if (!name) {
    console.log(JSON.stringify({ error: "Missing --name" }));
    process.exit(0);
  }

  const diagnostics = [];

  const res = await fetch(INDEX_URL, {
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0 (myconstituency.ca; +https://myconstituency.ca)",
    },
  });

  if (!res.ok) {
    console.log(JSON.stringify({ error: `Index fetch failed: ${res.status}` }));
    process.exit(0);
  }

  const html = await res.text();
  const pdfUrl = extractLatestVpPdfUrl(html);

  if (!pdfUrl) {
    console.log(JSON.stringify({ jurisdiction: "Alberta", mla: { name }, items: [], note: "No VP PDF found." }));
    process.exit(0);
  }

  if (debug) diagnostics.push({ step: "latest_pdf", pdfUrl });

  const pdfRes = await fetch(pdfUrl, {
    headers: {
      Accept: "application/pdf",
      "User-Agent": "Mozilla/5.0 (myconstituency.ca; +https://myconstituency.ca)",
    },
  });

  if (!pdfRes.ok) {
    console.log(JSON.stringify({ error: `PDF fetch failed: ${pdfRes.status}`, pdfUrl }));
    process.exit(0);
  }

  const ab = await pdfRes.arrayBuffer();
  const buf = Buffer.from(ab);

  const firstBytes = buf.slice(0, 10).toString("utf8");
  if (!firstBytes.startsWith("%PDF-")) {
    console.log(JSON.stringify({ error: "Not a PDF response", pdfUrl, firstBytes }));
    process.exit(0);
  }

  const text = await pdfBufferToText(buf);
  if (debug) diagnostics.push({ step: "pdf_text", textLen: text.length });

  const votes = extractVotesForMla(text, name, riding).slice(0, 12).map((v) => ({
    ...v,
    official_url: pdfUrl,
  }));

  const out = {
    jurisdiction: "Alberta",
    mla: { name, riding: riding || null },
    items: votes,
    note: votes.length ? undefined : "No recorded votes found in the latest Votes & Proceedings PDF.",
    diagnostics: debug ? diagnostics : undefined,
  };

  console.log(JSON.stringify(out));
}

main().catch((e) => {
  console.log(JSON.stringify({ error: e?.message || String(e) }));
});