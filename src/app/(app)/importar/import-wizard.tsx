"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2, FileUp, Loader2, RotateCcw } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  duplicateStatus, extractRows, guessColumns, IMPORT_LIMIT, isOwnExport, looksLikeHeader, parseCSV, shouldInvertByDefault,
  type ColumnMap, type DupStatus,
} from "@/lib/finance/csv-import";
import { formatDateBR, type ISODate } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import { norm, suggestCategory } from "@/lib/finance/quick-parse";
import { getImportExisting, importRows } from "@/lib/actions/import";
import { cn } from "@/lib/utils";

interface Props {
  today: ISODate;
  accounts: { id: string; name: string }[];
  cards: { id: string; name: string }[];
  categories: { id: string; name: string; kind: "income" | "expense" }[];
  history: { description: string; categoryId: string; kind: "income" | "expense" }[];
}

const MAX_BYTES = 3 * 1024 * 1024;

async function readText(file: File) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // muitos bancos ainda exportam em Latin-1 / Windows-1252
    return new TextDecoder("windows-1252").decode(buf);
  }
}

export function ImportWizard({ today, accounts, cards, categories, history }: Props) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [table, setTable] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [map, setMap] = useState<ColumnMap | null>(null);
  const [target, setTarget] = useState<string>(accounts[0]?.id ?? (cards[0] ? `card:${cards[0].id}` : ""));
  const [invert, setInvert] = useState(false);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [catOverride, setCatOverride] = useState<Record<number, string>>({});
  const [existing, setExisting] = useState<{ strict: Set<string>; loose: Set<string> }>({ strict: new Set(), loose: new Set() });
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const kind: "account" | "card" = target.startsWith("card:") ? "card" : "account";

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo muito grande (máx. 3 MB).");
      return;
    }
    const t = parseCSV(await readText(file));
    if (t.length === 0) {
      toast.error("Não encontrei linhas nesse arquivo.");
      return;
    }
    const header = looksLikeHeader(t[0]);
    const m = header ? guessColumns(t[0]) : guessColumns(t[0].map(() => ""));
    setFileName(file.name);
    setTable(t);
    setHasHeader(header);
    setMap(header ? m : { date: 0, description: 1, amount: Math.max(0, t[0].length - 1), credit: null, debit: null, type: null, category: null });
    setSelected({});
    setCatOverride({});
    setDone(null);
    const raw = extractRows(t, m, { hasHeader: header, invert: false, target: kind });
    setInvert(shouldInvertByDefault(raw, kind));
  }

  function changeTarget(v: string) {
    setTarget(v);
    setSelected({});
    setCatOverride({});
    if (map && table.length) {
      const k = v.startsWith("card:") ? "card" : "account";
      setInvert(shouldInvertByDefault(extractRows(table, map, { hasHeader, invert: false, target: k }), k));
    }
  }

  const rows = useMemo(
    () => (map ? extractRows(table, map, { hasHeader, invert, target: kind }) : []),
    [table, map, hasHeader, invert, kind],
  );

  // datas do arquivo → busca o que já existe na conta/cartão para marcar duplicados
  const range = useMemo(() => {
    const ds = rows.map((r) => r.date).filter((d): d is string => !!d).sort();
    return ds.length ? { from: ds[0], to: ds[ds.length - 1] } : null;
  }, [rows]);
  useEffect(() => {
    if (!range || !target) return;
    let alive = true;
    getImportExisting({ target, ...range }).then((r) => {
      if (alive) setExisting({ strict: new Set(r.strict), loose: new Set(r.loose) });
    });
    return () => {
      alive = false;
    };
  }, [range, target]);

  const own = hasHeader && isOwnExport(table[0] ?? []);
  const view = useMemo(
    () =>
      rows.map((r) => {
        const entryKind: "income" | "expense" = kind === "card" ? "expense" : (r.amountCents ?? 0) > 0 ? "income" : "expense";
        const kindCats = categories.filter((c) => c.kind === entryKind);
        const fromFile = r.categoryRaw ? kindCats.find((c) => norm(c.name) === norm(r.categoryRaw))?.id : undefined;
        const suggested = fromFile ?? suggestCategory(r.description, entryKind, categories, history) ?? "";
        const dup: DupStatus = r.error ? null : duplicateStatus({ date: r.date!, amountCents: r.amountCents!, description: r.description }, existing);
        const defaultOn = !r.error && !r.skip && !dup;
        const override = catOverride[r.line];
        return {
          ...r,
          entryKind,
          kindCats,
          dup,
          categoryId: override && kindCats.some((c) => c.id === override) ? override : suggested,
          on: !r.error && (selected[r.line] ?? defaultOn),
        };
      }),
    [rows, kind, categories, history, existing, selected, catOverride],
  );

  const chosen = view.filter((r) => r.on);
  const totals = chosen.reduce(
    (a, r) => (r.amountCents! > 0 ? { ...a, in: a.in + r.amountCents! } : { ...a, out: a.out - r.amountCents! }),
    { in: 0, out: 0 },
  );
  const counts = {
    errors: view.filter((r) => r.error).length,
    dups: view.filter((r) => r.dup === "duplicate").length,
    possible: view.filter((r) => r.dup === "possible").length,
    skipped: view.filter((r) => r.skip && !r.error).length,
  };
  const header = table[0] ?? [];
  const columns = header.map((h, i) => ({ i, label: hasHeader ? h || `Coluna ${i + 1}` : `Coluna ${i + 1} (${h.slice(0, 18)})` }));

  function submit() {
    if (!chosen.length) return;
    if (chosen.length > IMPORT_LIMIT) {
      toast.error(`Selecione no máximo ${IMPORT_LIMIT} linhas por vez.`);
      return;
    }
    const missing = chosen.find((r) => !r.categoryId);
    if (missing) {
      toast.error(`Escolha a categoria da linha ${missing.line}.`);
      return;
    }
    start(async () => {
      const res = await importRows({
        target,
        rows: chosen.map((r) => ({ date: r.date!, description: r.description, amountCents: r.amountCents!, categoryId: r.categoryId })),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setDone(res.message);
    });
  }

  function reset() {
    setFileName(null);
    setTable([]);
    setMap(null);
    setDone(null);
  }

  if (done) {
    return (
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="size-10 text-positive" aria-hidden />
          <p className="font-medium">{done}</p>
          <p className="text-sm text-muted-foreground">Os lançamentos já aparecem nos saldos, relatórios e movimentações.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/movimentacoes">Ver movimentações</Link>
            </Button>
            <Button variant="outline" onClick={reset}>
              <RotateCcw /> Importar outro arquivo
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      <Card>
        <CardHeader title="1. Arquivo e destino" />
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Arquivo CSV" htmlFor="csv-file" hint={fileName ? `${fileName} · ${rows.length} linhas` : "Separado por ; ou , — valores e datas no formato brasileiro ou internacional."}>
            <label
              htmlFor="csv-file"
              className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-input bg-card px-3 text-sm text-muted-foreground hover:bg-muted"
            >
              <FileUp className="size-4" aria-hidden />
              <span className="truncate">{fileName ?? "Escolher arquivo…"}</span>
            </label>
            <input
              id="csv-file"
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </Field>
          <Field label="Importar para" htmlFor="csv-target">
            <NativeSelect id="csv-target" value={target} onChange={(e) => changeTarget(e.target.value)}>
              {accounts.length > 0 && (
                <optgroup label="Contas">
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </optgroup>
              )}
              {cards.length > 0 && (
                <optgroup label="Cartões de crédito">
                  {cards.map((c) => (
                    <option key={c.id} value={`card:${c.id}`}>{c.name}</option>
                  ))}
                </optgroup>
              )}
            </NativeSelect>
          </Field>
        </CardBody>
      </Card>

      {map && (
        <Card>
          <CardHeader
            title="2. Colunas"
            description={own ? "Reconheci o CSV do Meu Financeiro. Transferências e pagamentos de fatura não são importados." : "Confira se reconheci as colunas certas."}
          />
          <CardBody className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ColSelect label="Data" value={map.date} columns={columns} onChange={(v) => setMap({ ...map, date: v ?? 0 })} />
            <ColSelect label="Descrição" value={map.description} columns={columns} onChange={(v) => setMap({ ...map, description: v ?? 0 })} />
            <ColSelect label="Valor" value={map.amount} columns={columns} empty="Crédito/débito separados" onChange={(v) => setMap({ ...map, amount: v })} />
            {map.amount == null && (
              <>
                <ColSelect label="Crédito (entradas)" value={map.credit} columns={columns} empty="—" onChange={(v) => setMap({ ...map, credit: v })} />
                <ColSelect label="Débito (saídas)" value={map.debit} columns={columns} empty="—" onChange={(v) => setMap({ ...map, debit: v })} />
              </>
            )}
            <ColSelect label="Tipo (D/C) — opcional" value={map.type} columns={columns} empty="—" onChange={(v) => setMap({ ...map, type: v })} />
            <ColSelect label="Categoria — opcional" value={map.category} columns={columns} empty="—" onChange={(v) => setMap({ ...map, category: v })} />
            <div className="col-span-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:col-span-4">
              <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
                Primeira linha é cabeçalho
                <Switch checked={hasHeader} onCheckedChange={setHasHeader} aria-label="Primeira linha é cabeçalho" />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm">
                <span>
                  Gastos vêm positivos
                  <span className="block text-xs text-muted-foreground">Comum em faturas de cartão</span>
                </span>
                <Switch checked={invert} onCheckedChange={setInvert} aria-label="Gastos vêm positivos" />
              </label>
            </div>
          </CardBody>
        </Card>
      )}

      {map && rows.length > 0 && (
        <Card className="pb-2">
          <CardHeader
            title="3. Conferir"
            description={
              <>
                {chosen.length} de {rows.length} selecionadas
                {counts.dups ? ` · ${counts.dups} já existem` : ""}
                {counts.possible ? ` · ${counts.possible} possíveis duplicadas` : ""}
                {counts.skipped ? ` · ${counts.skipped} ignoradas` : ""}
                {counts.errors ? ` · ${counts.errors} com erro` : ""}
              </>
            }
            action={
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setSelected(Object.fromEntries(view.filter((r) => !r.error).map((r) => [r.line, true])))}>
                  Todas
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(Object.fromEntries(view.map((r) => [r.line, false])))}>
                  Nenhuma
                </Button>
              </div>
            }
          />
          <ul className="mt-3 grid grid-cols-1 divide-y border-t" data-testid="import-rows">
            {view.map((r) => (
              <li key={r.line} className={cn("flex items-start gap-3 px-5 py-3", !r.on && "opacity-60")}>
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
                  checked={r.on}
                  disabled={!!r.error}
                  aria-label={`Importar linha ${r.line}`}
                  onChange={(e) => setSelected((s) => ({ ...s, [r.line]: e.target.checked }))}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.description || <span className="text-muted-foreground">(sem descrição)</span>}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{r.date ? formatDateBR(r.date) : `linha ${r.line}`}</span>
                    {r.error && <Tag tone="negative">{r.error}</Tag>}
                    {!r.error && r.dup === "duplicate" && <Tag tone="warning">já existe</Tag>}
                    {!r.error && r.dup === "possible" && <Tag tone="warning">possível duplicado</Tag>}
                    {!r.error && r.skip && <Tag>{r.skip}</Tag>}
                    {!r.error && r.date! > today && kind === "account" && <Tag>futuro: fica pendente</Tag>}
                  </p>
                  {!r.error && (
                    <select
                      className="mt-1.5 h-8 max-w-full rounded-lg border border-input bg-card px-2 text-xs"
                      value={r.categoryId}
                      aria-label={`Categoria da linha ${r.line}`}
                      onChange={(e) => setCatOverride((s) => ({ ...s, [r.line]: e.target.value }))}
                    >
                      {r.kindCats.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                {r.amountCents != null && (
                  <span className={cn("tabular shrink-0 text-sm font-medium", r.amountCents > 0 ? "text-positive" : "")}>
                    {r.amountCents > 0 ? "+" : "−"}{formatBRL(Math.abs(r.amountCents))}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-10 mx-3 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur md:bottom-3">
            <p className="text-xs text-muted-foreground">
              {kind === "card" ? "Saídas viram compras à vista; entradas, créditos na fatura." : "Entradas viram receitas; saídas, despesas."}
              <span className="block tabular text-foreground">
                {totals.in > 0 && <>+{formatBRL(totals.in)} </>}
                {totals.out > 0 && <>−{formatBRL(totals.out)}</>}
              </span>
            </p>
            <Button onClick={submit} disabled={pending || !chosen.length || !target}>
              {pending && <Loader2 className="animate-spin" />}
              Importar {chosen.length} {chosen.length === 1 ? "lançamento" : "lançamentos"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function ColSelect({
  label, value, columns, onChange, empty,
}: {
  label: string;
  value: number | null;
  columns: { i: number; label: string }[];
  onChange: (v: number | null) => void;
  empty?: string;
}) {
  const id = `col-${label.replace(/\W+/g, "-")}`;
  return (
    <Field label={label} htmlFor={id}>
      <NativeSelect id={id} value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}>
        {empty && <option value="">{empty}</option>}
        {columns.map((c) => (
          <option key={c.i} value={c.i}>{c.label}</option>
        ))}
      </NativeSelect>
    </Field>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone?: "warning" | "negative" }) {
  return (
    <span
      className={cn(
        "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
        tone === "warning" ? "bg-warning-soft text-warning" : tone === "negative" ? "bg-negative-soft text-negative" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
