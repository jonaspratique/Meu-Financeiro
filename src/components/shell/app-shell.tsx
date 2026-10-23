"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu as MenuIcon, Plus, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { signOut } from "@/lib/actions/auth";
import { useEntryDialog } from "@/components/entry/entry-provider";
import { isActive, NAV, IMPORT, SETTINGS } from "./nav";
import { ThemeSwitcher } from "./theme";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-2">
      <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Wallet className="size-4" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Meu Financeiro</span>
    </Link>
  );
}

export function AppShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const { openNew } = useEntryDialog();
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.hydrated = "1"; // usado pelos testes de ponta a ponta
  }, []);

  const mobileMain = [NAV[0], NAV[1]];
  const mobileRight = [NAV[2]];
  const more = [NAV[3], NAV[4], NAV[5], IMPORT, SETTINGS];

  return (
    <div className="min-h-dvh">
      {/* ---------- Sidebar (desktop) ---------- */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-card/60 px-3 py-5 backdrop-blur md:flex">
        <Logo />
        <Button variant="brand" className="mx-1 mt-6 h-11" onClick={() => openNew()}>
          <Plus /> Novo lançamento
          <kbd className="ml-auto rounded-md bg-white/20 px-1.5 text-[10px] font-medium">N</kbd>
        </Button>
        <nav className="mt-6 grid gap-0.5" aria-label="Principal">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
                  active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto grid gap-3">
          <ThemeSwitcher className="w-full" />
          <div className="flex items-center gap-2 rounded-xl px-2 py-1">
            <Link
              href={SETTINGS.href}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-sm hover:bg-muted",
                isActive(pathname, SETTINGS.href) && "bg-muted",
              )}
              title="Configurações"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold uppercase text-accent-foreground">
                {email.slice(0, 1)}
              </span>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </Link>
            <form action={signOut}>
              <Button variant="ghost" size="icon-sm" title="Sair" aria-label="Sair">
                <LogOut />
              </Button>
            </form>
          </div>
        </div>
      </aside>

      {/* ---------- Conteúdo ---------- */}
      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/80 px-4 backdrop-blur md:hidden">
          <Logo />
          <Link
            href={SETTINGS.href}
            className="flex size-8 items-center justify-center rounded-full bg-accent text-xs font-semibold uppercase text-accent-foreground"
            aria-label="Configurações"
          >
            {email.slice(0, 1)}
          </Link>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 md:px-8 md:pb-12 md:pt-8">{children}</main>
      </div>

      {/* ---------- Navegação inferior (celular) ---------- */}
      <nav
        aria-label="Principal"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden"
      >
        <div className="grid h-16 grid-cols-5 items-center">
          {mobileMain.map((item) => (
            <MobileLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => openNew()}
              aria-label="Novo lançamento"
              className="-mt-6 flex size-14 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/30 transition active:scale-95"
            >
              <Plus className="size-6" />
            </button>
          </div>
          {mobileRight.map((item) => (
            <MobileLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              "flex flex-col items-center gap-1 text-[11px]",
              more.some((m) => isActive(pathname, m.href)) ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <MenuIcon className="size-5" />
            Mais
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent title="Mais opções">
          <div className="grid gap-1">
            {more.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-3 text-sm",
                  isActive(pathname, item.href) ? "bg-muted font-medium" : "hover:bg-muted",
                )}
              >
                <item.icon className="size-4 text-muted-foreground" />
                {item.label}
              </Link>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
            <ThemeSwitcher />
            <form action={signOut}>
              <Button variant="ghost" size="sm">
                <LogOut /> Sair
              </Button>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MobileLink({ item, active }: { item: (typeof NAV)[number]; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn("flex flex-col items-center gap-1 text-[11px]", active ? "font-medium text-foreground" : "text-muted-foreground")}
    >
      <item.icon className="size-5" />
      {item.short}
    </Link>
  );
}
