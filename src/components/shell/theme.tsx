"use client";

import { Droplets, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Theme = "system" | "light" | "dark";
const KEY = "mf-theme";
const GLASS_KEY = "mf-glass";

/** Script executado antes da pintura para evitar "flash" de tema errado. */
export const themeScript = `(function(){try{var t=localStorage.getItem('${KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.classList.toggle('glass',localStorage.getItem('${GLASS_KEY}')==='1')}catch(e){}})()`;

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => {
    let t: Theme = "system";
    try {
      t = (localStorage.getItem(KEY) as Theme) || "system";
    } catch {}
    setThemeState(t);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply((localStorage.getItem(KEY) as Theme) || "system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    apply(t);
  };
  return { theme, setTheme };
}

export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const opts: { v: Theme; icon: typeof Sun; label: string }[] = [
    { v: "light", icon: Sun, label: "Claro" },
    { v: "dark", icon: Moon, label: "Escuro" },
    { v: "system", icon: Monitor, label: "Sistema" },
  ];
  return (
    <div role="radiogroup" aria-label="Tema" className={cn("inline-flex rounded-xl bg-muted p-1", className)}>
      {opts.map(({ v, icon: Icon, label }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={theme === v}
          title={label}
          onClick={() => setTheme(v)}
          className={cn(
            "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition",
            theme === v ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

/** Liquid Glass: liga/desliga o efeito de vidro (combina com claro, escuro e sistema). */
export function GlassToggle({ className, compact }: { className?: string; compact?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(document.documentElement.classList.contains("glass"));
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    document.documentElement.classList.toggle("glass", next);
    try {
      localStorage.setItem(GLASS_KEY, next ? "1" : "0");
    } catch {}
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      title="Efeito Liquid Glass"
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-xl border px-3 text-xs font-medium transition",
        on ? "border-brand/40 bg-brand/10 text-foreground" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <Droplets className="size-3.5" />
        {compact ? "Liquid Glass" : "Efeito Liquid Glass"}
      </span>
      <span className={cn("relative inline-flex h-4 w-7 rounded-full transition", on ? "bg-brand" : "bg-input")} aria-hidden>
        <span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow transition-all", on ? "left-3.5" : "left-0.5")} />
      </span>
    </button>
  );
}
