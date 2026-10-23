"use client";

import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipContentProps,
} from "recharts";
import { formatBRL } from "@/lib/finance/money";

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
/** Eixo em reais compactos: "1,5 mil", "12 mil" (a moeda está no título/tooltip). */
const axisMoney = (v: number) => compact.format(v / 100);

export interface SeriesDef {
  key: string;
  label: string;
  /** variável CSS, ex.: "var(--chart-income)" */
  color: string;
}

type Datum = { label: string } & Record<string, number | string>;

const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fontSize: 11, fill: "var(--muted-foreground)" },
} as const;

function Legend({ series }: { series: SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function ChartTooltip({ active, payload, label, series }: TooltipContentProps & { series: SeriesDef[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{String(label)}</p>
      {series.map((s) => {
        const item = payload.find((p) => p.dataKey === s.key);
        if (!item) return null;
        return (
          <p key={s.key} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </span>
            <span className="tabular font-medium">{formatBRL(Number(item.value))}</span>
          </p>
        );
      })}
    </div>
  );
}

/** Tabela acessível equivalente ao gráfico (leitores de tela). */
function SrTable({ data, series, caption, xLabel = "Mês" }: { data: Datum[]; series: SeriesDef[]; caption: string; xLabel?: string }) {
  return (
    // a tabela fica dentro de um div sr-only: tabelas ignoram width:1px e causariam rolagem lateral
    <div className="sr-only">
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th>{xLabel}</th>
          {series.map((s) => (
            <th key={s.key}>{s.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.label}>
            <td>{d.label}</td>
            {series.map((s) => (
              <td key={s.key}>{formatBRL(Number(d[s.key] ?? 0))}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export function BarsChart({ data, series, caption, height = 240 }: { data: Datum[]; series: SeriesDef[]; caption: string; height?: number }) {
  return (
    <figure>
      <Legend series={series} />
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis {...axisProps} width={56} tickFormatter={(v) => axisMoney(Number(v))} />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={(p) => <ChartTooltip {...p} series={series} />} />
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <SrTable data={data} series={series} caption={caption} />
    </figure>
  );
}

export function LinesChart({
  data, series, caption, height = 220, dots = true, xLabel, zeroLine = false,
}: { data: Datum[]; series: SeriesDef[]; caption: string; height?: number; dots?: boolean; xLabel?: string; zeroLine?: boolean }) {
  return (
    <figure>
      <Legend series={series} />
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" {...axisProps} minTickGap={16} />
            <YAxis {...axisProps} width={56} tickFormatter={(v) => axisMoney(Number(v))} />
            {zeroLine && <ReferenceLine y={0} stroke="var(--negative)" strokeDasharray="4 4" />}
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
              content={(p) => <ChartTooltip {...p} series={series} />}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                isAnimationActive={false}
                dot={dots ? { r: 3, strokeWidth: 2, stroke: "var(--card)", fill: s.color } : false}
                activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--card)" }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <SrTable data={data} series={series} caption={caption} xLabel={xLabel} />
    </figure>
  );
}
