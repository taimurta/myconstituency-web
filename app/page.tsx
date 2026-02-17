"use client";
import Image from "next/image";
import { useMemo, useState, useRef, useEffect } from "react";
import { Button, Card, Input, Pill } from "@/components/ui";
import type { LookupResponse } from "@/lib/types";


function formatPostal(input: string) {
  const raw = input.replace(/\s+/g, "").toUpperCase();
  if (raw.length <= 3) return raw;
  return raw.slice(0, 3) + " " + raw.slice(3, 6);
}

function sortMunicipal(reps: LookupResponse["reps"]["municipal"]) {
  const isMayor = (r: any) =>
    (r.elected_office || "").toLowerCase().includes("mayor");

  // Keep original order except move mayor(s) to the end
  const nonMayor = reps.filter((r) => !isMayor(r));
  const mayor = reps.filter((r) => isMayor(r));
  return [...nonMayor, ...mayor];
}

function normalizeVote(v: any) {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("yea") || s === "yes") return "YES";
  if (s.includes("nay") || s === "no") return "NO";
  if (s.includes("paired")) return "PAIRED";
  if (s.includes("absent") || s.includes("missed")) return "ABSENT";
  return s ? s.toUpperCase() : "—";
}

function voteTone(vote: string) {
  if (vote === "YES") return "yes";
  if (vote === "NO") return "no";
  return "other";
}

function VoteDot({ vote }: { vote: string }) {
  const tone = voteTone(vote);
  return (
    <span
      className={
        "inline-block h-2.5 w-2.5 rounded-full " +
        (tone === "yes"
          ? "bg-emerald-500"
          : tone === "no"
          ? "bg-rose-500"
          : "bg-zinc-300")
      }
      aria-hidden="true"
    />
  );
}

function formatVoteTitle(title: string) {
  const t = (title || "").trim();

  // bill code like C-227 or S-210
  const billMatch = t.match(/\b([CS]-\d+)\b/i);
  const billCode = billMatch ? billMatch[1].toUpperCase() : null;

  // stage like "2nd reading"
  const stageMatch = t.match(/\b(1st|2nd|3rd)\s+reading\b/i);
  const stage = stageMatch ? stageMatch[0].toLowerCase() : null;

  const isBill = /\bBill\b/i.test(t) || !!billCode;
  const type = isBill ? "Bill" : "Motion";

  // pull the "An Act ..." part if it exists
  const actIdx = t.toLowerCase().indexOf("an act");
  let short = actIdx >= 0 ? t.slice(actIdx) : t;

  // clean prefixes like "2nd reading of Bill C-123,"
  short = short
    .replace(/^(1st|2nd|3rd)\s+reading of\s+/i, "")
    .replace(/^Bill\s+[CS]-\d+,\s*/i, "")
    .replace(/^Opposition Motion\s*\((.*?)\)\s*/i, "Opposition motion: $1")
    .trim();

  // keep it short
  if (short.length > 90) short = short.slice(0, 87) + "…";

  return { type, billCode, stage, short };
}


export default function HomePage() {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [voteLoadingKey, setVoteLoadingKey] = useState<string | null>(null);
  const [voteErrorKey, setVoteErrorKey] = useState<string | null>(null);
  const [voteData, setVoteData] = useState<Record<string, any>>({});
  const [postal, setPostal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LookupResponse | null>(null);
  const canSearch = useMemo(() => postal.replace(/\s+/g, "").length >= 6, [postal]);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const [modal, setModal] = useState<null | "privacy" | "terms" | "about">(null);



  async function onSearch() {
    setLoading(true);
    setError(null);
    setData(null);

    // reset vote-related state
    setExpandedKey(null);
    setVoteLoadingKey(null);
    setVoteErrorKey(null);
    setVoteData({});

    try {
      const res = await fetch(`/api/lookup?postal=${encodeURIComponent(postal)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Lookup failed");
      setData(json);
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

 async function loadFederalVotes(repKey: string, name: string, riding?: string) {
  setVoteLoadingKey(repKey);
  setVoteErrorKey(null);

  try {
    const res = await fetch(
      `/api/federal-votes?name=${encodeURIComponent(name)}&riding=${encodeURIComponent(riding || "")}`
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error || "Failed to load votes");
    setVoteData((prev) => ({ ...prev, [repKey]: json }));
  } catch (e: any) {
    setVoteErrorKey(e?.message ?? "Failed to load votes");
  } finally {
    setVoteLoadingKey(null);
  }
}

function RepsCard({
  title,
  reps,
}: {
  title: string;
  reps: LookupResponse["reps"]["municipal"];
}) {
  return (
    <Card>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">{title}</div>
          <InfoTooltip title={title} />
        </div>

        {reps.length === 0 ? (
          <div className="text-sm text-zinc-600">
            No results returned. Try a different postal code.
          </div>
        ) : (
          <div className="space-y-4">
            {reps
              .slice(0, 3)
              .filter((r) => r && r.name)
              .map((r) => {
                const repKey = `${title}-${r.name}-${r.district_name || ""}`;
                const isFederal = title === "Federal";
                const isOpen = expandedKey === repKey;

                const votes = voteData[repKey]?.items as any[] | undefined;
                const summary = (() => {
                  const list = (votes ?? []).map((it: any) => normalizeVote(it.vote));

                  const yes = list.filter((v) => v === "YES").length;
                  const no = list.filter((v) => v === "NO").length;
                  const other = list.filter((v) => v !== "YES" && v !== "NO" && v !== "—").length;

                  const total = yes + no + other;
                  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);

                  return { yes, no, other, total, yesPct: pct(yes), noPct: pct(no), otherPct: pct(other) };
                })();

                const counts = (() => {
                  const list = (votes ?? []).map((it: any) => normalizeVote(it.vote));
                  const yes = list.filter(v => v === "YES").length;
                  const no = list.filter(v => v === "NO").length;
                  const other = list.length - yes - no;
                  return { yes, no, other };
                })();

                const profileUrl = voteData[repKey]?.mp?.profile_url as
                  | string
                  | undefined;

                  function formatDate(d?: string) {
                    if (!d) return "";
                    const date = new Date(d);
                    return date.toLocaleDateString("en-CA", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    });
                  }

                return (
                  <div key={repKey} className="space-y-2">
                    <div className="flex items-center gap-3">
                      {/* Avatar */}
                      <div className="h-12 w-12 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200">
                        {r.photo_url ? (
                          <img
                            src={r.photo_url}
                            alt={r.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-zinc-600">
                            {getInitials(r.name)}
                          </div>
                        )}
                      </div>

                      {/* Name + subtitle */}
                      <div className="min-w-0">
                        <div className="font-medium leading-tight">{r.name}</div>
                        <div className="text-sm text-zinc-600">
                          {r.elected_office}
                          {r.district_name ? ` • ${r.district_name}` : ""}
                          {r.party_name ? ` • ${r.party_name}` : ""}
                        </div>
                      </div>
                    </div>

                    {/* Links row */}
                    <div className="flex flex-wrap items-center gap-4 pt-1 text-sm">
                      {r.email && (
                        <a className="underline" href={`mailto:${r.email}`}>
                          Email
                        </a>
                      )}
                      {r.url && (
                        <a
                          className="underline"
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Official page
                        </a>
                      )}

                      {/* Expand / Collapse (Federal only) */}
                      {isFederal && (
                        <button
                          className="underline"
                          onClick={async () => {
                            if (isOpen) {
                              setExpandedKey(null);
                              return;
                            }
                            setExpandedKey(repKey);

                            // Only load once per rep
                            if (!voteData[repKey]) {
                              await loadFederalVotes(repKey, r.name, r.district_name);
                            }
                          }}
                        >
                          {isOpen ? "Collapse" : "Expand"}
                        </button>
                      )}

                    </div>

                    {/* Expanded section (Federal only) */}
                    {isFederal && isOpen && (
                      <div className="mt-3 rounded-2xl bg-zinc-50 p-4">
                        {/* Voting summary (no extra card, just text) */}
                        <div className="mt-3 space-y-2 text-sm text-zinc-700">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500/80" />
                              <span>Yes</span>
                            </div>
                            <div className="font-medium">{summary.total ? `${summary.yes} (${summary.yesPct}%)` : "—"}</div>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500/80" />
                              <span>No</span>
                            </div>
                            <div className="font-medium">{summary.total ? `${summary.no} (${summary.noPct}%)` : "—"}</div>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="inline-block h-2.5 w-2.5 rounded-full bg-zinc-300" />
                              <span>Other / missed</span>
                            </div>
                            <div className="font-medium">{summary.total ? `${summary.other} (${summary.otherPct}%)` : "—"}</div>
                          </div>

                          <div className="pt-2 text-xs text-zinc-500">
                            Based on the most recent {Math.min((votes ?? []).length, 5)} votes shown below.
                          </div>
                        </div>


                        {/* Recent key votes: ONE card */}
                        <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4">
                          <div className="text-sm font-semibold text-zinc-900">Recent Key Votes</div>

                          {voteLoadingKey === repKey && (
                            <div className="mt-3 text-sm text-zinc-600">Loading votes…</div>
                          )}

                          {!voteLoadingKey && voteErrorKey && (
                            <div className="mt-3 text-sm text-rose-700">{voteErrorKey}</div>
                          )}

                          {!voteLoadingKey && !voteErrorKey && (
                            <div className="mt-3 divide-y divide-zinc-100">
                              {(votes ?? []).slice(0, 5).map((it: any, i: number) => {
                                const v = normalizeVote(it.vote);
                                const passed =
                                  it.result?.toLowerCase() === "passed"
                                    ? "PASSED"
                                    : it.result?.toLowerCase() === "failed"
                                    ? "FAILED"
                                    : null;

                                const meta = formatVoteTitle(it.title);

                                // Build one clean headline:
                                // "Bill S-210 — An Act respecting Ukrainian Heritage Month"
                                // or "Motion — Opposition motion: Food affordability"
                                const headlineLeft = meta.billCode
                                  ? `${meta.type} ${meta.billCode}`
                                  : `${meta.type}`;

                                const headline = `${headlineLeft} — ${meta.short}`;

                                return (
                                  <div
                                    key={it.vote_url ?? `${it.title}-${it.date ?? "na"}-${i}`}
                                    className="py-3"
                                  >
                                    {/* Headline */}
                                    <div className="text-sm font-medium text-zinc-900">
                                      {headline}
                                    </div>

                                    {/* Vote line */}
                                    <div className="mt-2 flex items-center gap-2 text-sm">
                                      <span className="text-zinc-600">Vote:</span>
                                      <VoteDot vote={v} />
                                      <span
                                        className={
                                          v === "YES"
                                            ? "font-semibold text-emerald-700"
                                            : v === "NO"
                                            ? "font-semibold text-rose-700"
                                            : "font-semibold text-zinc-700"
                                        }
                                      >
                                        {v}
                                      </span>

                                      {meta.stage ? (
                                        <span className="text-zinc-500">• {meta.stage}</span>
                                      ) : null}
                                    </div>

                                    {/* Date + link */}
                                    <div className="mt-1 text-xs text-zinc-500">
                                      {it.date ?? ""}
                                      {it.vote_url ? (
                                        <>
                                          {" • "}
                                          <a className="underline" href={it.vote_url} target="_blank" rel="noreferrer">
                                            Official vote
                                          </a>
                                        </>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}



                              {(votes ?? []).length === 0 && (
                                <div className="py-3 text-sm text-zinc-600">No recent votes found.</div>
                              )}
                            </div>
                          )}

                          {profileUrl && (
                            <div className="mt-4">
                              <a className="underline text-sm" href={profileUrl} target="_blank" rel="noreferrer">
                                View complete parliamentary record →
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  </div>
                );
              })}

            {reps.length > 2 && (
              <div className="text-xs text-zinc-500">
                + {reps.length - 2} more (postal codes can overlap districts)
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}



  return (
    <div className="mx-auto max-w-6xl px-6 pt-1 pb-16 md:px-1 md:pt-2 md:pb-20">
  <section className="relative">

    

    <div className="relative px-6 py-10 md:px-12 md:py-14">
      <div className="grid items-center gap-10 md:grid-cols-2">
        {/* LEFT */}
        <div className="space-y-6">
          <h1 className="text-4xl font-extrabold leading-[0.95] tracking-tight text-zinc-900 md:text-5xl">
            Know Your Leaders.
            <br />
            Instantly
          </h1>

          <div className="max-w-sm space-y-4 pt-2">
            <Input
              placeholder="Enter a Canadian postal code"
              value={postal}
              onChange={(e) => setPostal(formatPostal(e.target.value))}
              inputMode="text"
              autoCapitalize="characters"
            />

            <Button onClick={onSearch} disabled={!canSearch || loading} className="h-12">
              {loading ? "Searching…" : "Find my Representatives"}
            </Button>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div className="flex justify-center md:justify-end">
          <div className="relative w-full max-w-sm">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative -mt-4 h-[320px] w-[320px] md:-mt-10 md:h-[420px] md:w-[420px]">
                <Image
                  src="/hero.png"
                  alt="Parliament illustration"
                  fill
                  priority
                  className="object-contain drop-shadow-[0_22px_55px_rgba(37,99,235,0.20)]"
                />
              </div>
            </div>
            <div className="aspect-square w-full" />
          </div>
        </div>
      </div>

      <div className="mt-10 text-center text-xs text-zinc-500">
        Trusted by Canadians. Data from official sources.
      </div>
    </div>
  </section>

  {/* RESULTS stay exactly like before */}
  {data && (
  <div ref={resultsRef} className="mt-10 scroll-mt-24 space-y-6">
      <div className="flex flex-wrap gap-2">
        <Pill>Postal: {data.postal}</Pill>
        {data.city && <Pill>City: {data.city}</Pill>}
        {data.province && <Pill>Province: {data.province}</Pill>}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <RepsCard title="Municipal" reps={sortMunicipal(data.reps.municipal)} />
        <RepsCard title="Provincial" reps={data.reps.provincial} />
        <RepsCard title="Federal" reps={data.reps.federal} />
        
      </div>

      <Issues />
    </div>
  )}
  <footer className="mt-16 pb-10 text-center text-sm text-zinc-500">
  <div className="flex items-center justify-center gap-6">
    <button className="hover:text-zinc-900" onClick={() => setModal("privacy")}>Privacy</button>
    <button className="hover:text-zinc-900" onClick={() => setModal("terms")}>Terms</button>
    <button className="hover:text-zinc-900" onClick={() => setModal("about")}>About</button>
  </div>
</footer>

{modal && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    onClick={() => setModal(null)}
  >
    <div
      className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="text-lg font-semibold">
          {modal === "privacy" ? "Privacy" : modal === "terms" ? "Terms" : "About"}
        </div>
        <button
          className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          onClick={() => setModal(null)}
        >
          Close
        </button>
      </div>

      <div className="mt-4 space-y-3 text-sm text-zinc-700">
        {modal === "privacy" && (
          <>
            <p>
              We don’t require accounts and we don’t sell personal data. Postal codes you enter are used only to fetch
              your representatives and display results.
            </p>
            <p>
              Basic technical logs (like IP address and browser info) may be collected by our hosting provider for
              security and performance.
            </p>
          </>
        )}

        {modal === "terms" && (
          <>
            <p>
              This site is provided “as is” for informational purposes. We aim for accuracy, but boundaries and offices
              can change.
            </p>
            <p>
              Always verify details on official government pages. By using the site, you agree not to misuse it or
              attempt to disrupt service.
            </p>
          </>
        )}

        {modal === "about" && (
          <>
            <p>
              myconstituency helps Canadians quickly find their municipal, provincial, and federal representatives. 
              This platform is aimed to promote transparency on issues affecting Canadians in their respective constituencies. 
            </p>
            <p className="font-medium text-zinc-900">Data sources</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Represent (Open North) for representative lookups</li>
              <li>Parliament of Canada (LEGISinfo) for federal bills/issues</li>
              <li>City of Calgary Newsroom for municipal updates</li>
              <li>Legislative Assembly of Alberta for provincial bill activity</li>
            </ul>
            <p className="text-xs text-zinc-500">
              Note: postal-code lookups are usually accurate, but some postal codes overlap boundaries.
            </p>
          </>
        )}
      </div>
    </div>
  </div>
)}

</div>

  );
}


function InfoTooltip({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const description =
    title === "Municipal"
      ? "Handles local issues like roads, garbage, and city bylaws."
      : title === "Provincial"
      ? "Handles healthcare, education, and provincial laws."
      : "Handles national laws, immigration, and defense.";

  useEffect(() => {
    if (!open) return;

    function onDown(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-700 hover:bg-zinc-200"
        aria-label={`${title} info`}
      >
        i
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-20 w-64 rounded-xl border border-zinc-200 bg-white p-3 text-xs text-zinc-700 shadow-lg">
          {description}
        </div>
      )}
    </div>
  );
}



function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase();
}

function Issues() {
  const [tab, setTab] = useState<"city" | "provincial" | "federal">("city");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load(nextTab: typeof tab) {
    setTab(nextTab);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/issues?source=${nextTab}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed");
      setItems(json.items || []);
    } catch (e: any) {
      setError(e?.message ?? "Failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  // lazy load on first show
  useState(() => { load("city"); });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Current issues</div>
          <div className="text-sm text-zinc-600">Pulled live from official sources.</div>
        </div>

        <div className="flex gap-2">
          {(["city", "provincial", "federal"] as const).map((k) => (
            <button
              key={k}
              onClick={() => load(k)}
              className={
                "rounded-xl border px-3 py-2 text-sm " +
                (tab === k ? "bg-zinc-900 text-white" : "bg-white text-zinc-900 hover:bg-zinc-50")
              }
            >
              {k === "city" ? "Calgary" : k === "provincial" ? "Alberta" : "Canada"}
            </button>
          ))}
        </div>
      </div>

      <Card>
        {loading && <div className="text-sm text-zinc-600">Loading…</div>}
        {error && <div className="text-sm text-red-700">{error}</div>}
        {!loading && !error && (
          <div className="space-y-4">
            {items.slice(0, 10).map((it, idx) => (
              <div key={idx} className="space-y-1">
                <a className="font-medium underline" href={it.link} target="_blank" rel="noreferrer">
                  {it.title}
                </a>
                {it.publishedAt && <div className="text-xs text-zinc-500">{it.publishedAt}</div>}
                {it.summary && <div className="text-sm text-zinc-700">{it.summary}</div>}
              </div>
            ))}
            {items.length === 0 && <div className="text-sm text-zinc-600">No items found.</div>}
          </div>
        )}
      </Card>
    </div>
  );
}
