"use client";

import { useMemo, useState } from "react";
import { Button, Card, Input, Pill } from "@/components/ui";
import type { LookupResponse } from "@/lib/types";

function formatPostal(input: string) {
  const raw = input.replace(/\s+/g, "").toUpperCase();
  if (raw.length <= 3) return raw;
  return raw.slice(0, 3) + " " + raw.slice(3, 6);
}

export default function HomePage() {
  const [postal, setPostal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LookupResponse | null>(null);

  const canSearch = useMemo(() => postal.replace(/\s+/g, "").length >= 6, [postal]);

  async function onSearch() {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/lookup?postal=${encodeURIComponent(postal)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Lookup failed");
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Know who represents you</h1>
        <p className="max-w-2xl text-zinc-600">
          Enter a Calgary postal code and we’ll pull your current municipal, provincial, and federal representatives.
        </p>
      </div>

      <Card>
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-sm font-medium">Calgary Postal Code</div>
            <Input
              placeholder="e.g., T2Y 4K1"
              value={postal}
              onChange={(e) => setPostal(formatPostal(e.target.value))}
              inputMode="text"
              autoCapitalize="characters"
            />
            <div className="text-xs text-zinc-500">
              Tip: Postal codes are usually accurate, but not always perfect. An address-confirmation step can make it 100% exact.
            </div>
          </div>

          <Button onClick={onSearch} disabled={!canSearch || loading}>
            {loading ? "Searching…" : "Find my representatives"}
          </Button>

          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        </div>
      </Card>

      {data && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Pill>Postal: {data.postal}</Pill>
            {data.city && <Pill>City: {data.city}</Pill>}
            {data.province && <Pill>Province: {data.province}</Pill>}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <RepsCard title="Municipal" reps={data.reps.municipal} />
            <RepsCard title="Provincial" reps={data.reps.provincial} />
            <RepsCard title="Federal" reps={data.reps.federal} />
          </div>

          <Issues />
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
            {reps.slice(0, 2).map((r, idx) => (
              <div key={idx} className="space-y-1">
                <div className="font-medium">{r.name}</div>
                <div className="text-sm text-zinc-600">
                  {r.elected_office}
                  {r.district_name ? ` • ${r.district_name}` : ""}
                  {r.party_name ? ` • ${r.party_name}` : ""}
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
