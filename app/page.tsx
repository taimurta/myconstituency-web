"use client";
import Image from "next/image";
import { useMemo, useState, useRef } from "react";
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

export default function HomePage() {
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

function RepsCard({ title, reps }: { title: string; reps: LookupResponse["reps"]["municipal"] }) {
  return (
    <Card>
      <div className="space-y-3">
        <div className="text-sm font-semibold">{title}</div>
        {reps.length === 0 ? (
          <div className="text-sm text-zinc-600">No results returned. Try a different postal code.</div>
        ) : (
          <div className="space-y-4">
            {reps.slice(0, 3).filter(r => r && r.name).map((r, idx) => (
              <div key={idx} className="space-y-2">
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
                          // If image fails, hide it so fallback initials show next render
                          (e.currentTarget as HTMLImageElement).style.display = "none";
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

                <div className="flex flex-wrap gap-2 pt-1 text-sm">
                  {r.email && (
                    <a className="underline" href={`mailto:${r.email}`}>
                      Email
                    </a>
                  )}
                  {r.url && (
                    <a className="underline" href={r.url} target="_blank" rel="noreferrer">
                      Official page
                    </a>
                  )}
                  {r.source_url && (
                    <a className="underline" href={r.source_url} target="_blank" rel="noreferrer">
                      Source
                    </a>
                  )}
                </div>
              </div>
            ))}

            {reps.length > 2 && <div className="text-xs text-zinc-500">+ {reps.length - 2} more (postal codes can overlap districts)</div>}
          </div>
        )}
      </div>
    </Card>
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
