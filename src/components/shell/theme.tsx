"use client";

import { Droplets, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Theme = "system" | "light" | "dark";
const KEY = "mf-theme";
const GLASS_KEY = "mf-glass";

const WP_KEY = "mf-wallpaper";
const WP_IMG_KEY = "mf-wallpaper-img";

/**
 * Aplica as classes de tema/vidro e o papel de parede. Fica em texto porque
 * também roda antes da pintura (sem "flash") — ver themeScript.
 */
const applyAllSrc = `function(){var h=document.documentElement,t=localStorage.getItem('${KEY}')||'system',d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);h.classList.toggle('dark',d);h.classList.toggle('glass',localStorage.getItem('${GLASS_KEY}')==='1');var w=localStorage.getItem('${WP_KEY}')||'auto';if(w==='auto')w=d?'noite':'por-do-sol';var u='none';if(w==='foto'){var img=localStorage.getItem('${WP_IMG_KEY}');if(img)u='url("'+img+'")';else w=d?'noite':'por-do-sol'}if(w!=='foto'&&w!=='aurora')u='url("/wallpapers/'+w+'.svg")';h.dataset.wallpaper=w;h.style.setProperty('--glass-wallpaper',u)}`;

/** Script executado antes da pintura para evitar "flash" de tema errado. */
export const themeScript = `(function(){try{(${applyAllSrc})()}catch(e){}})()`;

function applyAll() {
  try {
    // eslint-disable-next-line no-new-func
    new Function(`(${applyAllSrc})()`)();
  } catch {}
}

export type Wallpaper = "auto" | "por-do-sol" | "noite" | "amanhecer" | "aurora" | "foto";
export const WALLPAPERS: { v: Wallpaper; label: string }[] = [
  { v: "auto", label: "Automático" },
  { v: "por-do-sol", label: "Pôr do sol" },
  { v: "noite", label: "Noite" },
  { v: "amanhecer", label: "Amanhecer" },
  { v: "aurora", label: "Cores suaves" },
  { v: "foto", label: "Sua foto" },
];
export function getWallpaper(): Wallpaper {
  try {
    return (localStorage.getItem(WP_KEY) as Wallpaper) || "auto";
  } catch {
    return "auto";
  }
}
export function setWallpaper(v: Wallpaper, image?: string) {
  try {
    if (image) localStorage.setItem(WP_IMG_KEY, image);
    localStorage.setItem(WP_KEY, v);
  } catch (e) {
    throw e;
  }
  applyAll();
}

function apply(_theme?: Theme) {
  applyAll();
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => {
    let t: Theme = "system";
    try {
      t = (localStorage.getItem(KEY) as Theme) || "system";
    } catch {}
    setThemeState(t);
    // reaplica depois da hidratação (se o React recriar o <html>, as classes voltam)
    apply(t);
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
    try {
      localStorage.setItem(GLASS_KEY, next ? "1" : "0");
    } catch {}
    applyAll();
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

const PREVIEW: Record<Exclude<Wallpaper, "auto" | "foto">, string> = {
  "por-do-sol": "url(/wallpapers/por-do-sol.svg) center/cover",
  noite: "url(/wallpapers/noite.svg) center/cover",
  amanhecer: "url(/wallpapers/amanhecer.svg) center/cover",
  aurora:
    "radial-gradient(60% 60% at 20% 25%, oklch(0.86 0.07 160), transparent 70%), radial-gradient(60% 60% at 85% 20%, oklch(0.8 0.08 265), transparent 70%), radial-gradient(60% 60% at 60% 85%, oklch(0.85 0.07 340), transparent 70%), oklch(0.97 0.01 260)",
};

/** Reduz a foto para caber no aparelho (localStorage) sem perder a cara de papel de parede. */
async function compressImage(file: File, max = 1920, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Escolha do papel de parede do Liquid Glass (fica salvo neste aparelho). */
export function WallpaperPicker() {
  const [value, setValue] = useState<Wallpaper>("auto");
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue(getWallpaper());
    try {
      setPhoto(localStorage.getItem(WP_IMG_KEY));
    } catch {}
  }, []);
  const choose = (v: Wallpaper) => {
    setError(null);
    setValue(v);
    setWallpaper(v);
  };
  const onFile = async (file?: File) => {
    if (!file) return;
    setError(null);
    try {
      const data = await compressImage(file);
      setWallpaper("foto", data);
      setPhoto(data);
      setValue("foto");
    } catch {
      setError("Não deu para usar essa imagem. Tente uma foto menor (JPG ou PNG).");
    }
  };
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">Fundo do Liquid Glass</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {WALLPAPERS.map((w) => {
          const bg =
            w.v === "auto"
              ? "linear-gradient(90deg, transparent 50%, transparent 50%), url(/wallpapers/por-do-sol.svg) left/200% 100%"
              : w.v === "foto"
                ? photo
                  ? `url("${photo}") center/cover`
                  : "repeating-linear-gradient(45deg, var(--muted), var(--muted) 6px, transparent 6px, transparent 12px)"
                : PREVIEW[w.v];
          const content = (
            <>
              <span
                className="block aspect-[4/3] w-full overflow-hidden rounded-lg border"
                style={{ background: w.v === "auto" ? undefined : bg }}
                aria-hidden
              >
                {w.v === "auto" && (
                  <span className="flex h-full">
                    <span className="h-full w-1/2" style={{ background: PREVIEW["por-do-sol"] }} />
                    <span className="h-full w-1/2" style={{ background: PREVIEW.noite }} />
                  </span>
                )}
              </span>
              <span className="mt-1 block truncate text-[11px] font-medium">{w.label}</span>
            </>
          );
          const cls = cn(
            "rounded-xl p-1.5 text-left transition",
            value === w.v ? "bg-brand/15 ring-2 ring-brand" : "hover:bg-muted",
          );
          return w.v === "foto" ? (
            <label key={w.v} className={cn(cls, "cursor-pointer")} title="Escolher uma foto do aparelho">
              {content}
              <input type="file" accept="image/*" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          ) : (
            <button key={w.v} type="button" onClick={() => choose(w.v)} className={cls} aria-pressed={value === w.v}>
              {content}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Automático usa o pôr do sol no tema claro e a noite no escuro. &quot;Sua foto&quot; fica salva só neste aparelho.
      </p>
      {error && <p className="text-xs text-negative">{error}</p>}
    </div>
  );
}
