import { NextResponse } from "next/server";
import path from "node:path";
import { spawn } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function runScript(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", "ab-votes-latest.mjs");

    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";

    child.stdout.on("data", (d) => (out += d.toString("utf8")));
    child.stderr.on("data", (d) => (err += d.toString("utf8")));

    child.on("close", (code) => {
      if (code !== 0 && !out) {
        reject(new Error(err || `Script failed (code ${code})`));
        return;
      }
      resolve(out.trim());
    });
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);

  const name = url.searchParams.get("name") || "";
  const riding = url.searchParams.get("riding") || ""; // optional but helps disambiguate duplicates
  const debug = url.searchParams.get("debug") === "1";

  if (!name.trim()) {
    return NextResponse.json({ error: "Missing name" }, { status: 400 });
  }

  try {
    const args = ["--name", name];
    if (riding.trim()) args.push("--riding", riding);
    if (debug) args.push("--debug", "1");

    const raw = await runScript(args);

    // script prints JSON
    const json = JSON.parse(raw);
    return NextResponse.json(json);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load Alberta votes" },
      { status: 500 }
    );
  }
}