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
  "w-full rounded-xl bg-gradient-to-b from-[#123A5F] to-[#0F2A44] px-4 py-3 text-sm font-semibold text-white shadow-md hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50 " +
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
        "w-full rounded-xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300 " +
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
