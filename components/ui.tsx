import * as React from "react";

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border bg-white p-5 shadow-sm">{children}</div>;
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = "", ...rest } = props;
  return (
    <button
      {...rest}
      className={
  "w-full rounded-xl bg-gradient-to-b from-[#3b82f6] to-[#2563eb] px-4 py-3 text-sm font-semibold tracking-wide text-white shadow-[0_10px_25px_rgba(37,99,235,0.35)] hover:brightness-105 active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 " +
  className}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return (
    <input
      {...rest}
      className={
        "w-full rounded-xl border border-zinc-300/80 bg-white/70 px-4 py-3 text-base text-zinc-900 shadow-sm outline-none placeholder:text-zinc-500 focus:border-blue-400 focus:ring-4 focus:ring-blue-200/50 " +
        className
      }
    />
  );
}


export function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700">
      {children}
    </span>
  );
}
