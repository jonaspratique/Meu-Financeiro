/**
 * Datas de negócio são strings ISO "AAAA-MM-DD" (sem fuso), exatamente como
 * o Postgres guarda o tipo `date`. Isso evita bugs de fuso horário.
 * "Hoje" é sempre calculado no fuso do usuário (America/Sao_Paulo).
 */

export const APP_TIMEZONE = "America/Sao_Paulo";

export type ISODate = string; // "2026-10-21"
export type MonthKey = string; // "2026-10"

export interface DateRange {
  from: ISODate; // inclusivo
  to: ISODate; // inclusivo
}

const pad = (n: number) => String(n).padStart(2, "0");

export function todayISO(now: Date = new Date(), timeZone = APP_TIMEZONE): ISODate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isISODate(s: unknown): s is ISODate {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthKeyOf(date: ISODate): MonthKey {
  return date.slice(0, 7);
}

export function isMonthKey(s: unknown): s is MonthKey {
  if (typeof s !== "string" || !/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5));
  const y = Number(s.slice(0, 4));
  return m >= 1 && m <= 12 && y >= 1990 && y <= 2200;
}

/** Lê ?m=2026-10 com fallback para o mês atual. */
export function parseMonthParam(value: unknown, today: ISODate = todayISO()): MonthKey {
  const v = Array.isArray(value) ? value[0] : value;
  return isMonthKey(v) ? v : monthKeyOf(today);
}

export function monthRange(key: MonthKey): DateRange {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return { from: `${key}-01`, to: `${key}-${pad(daysInMonth(y, m))}` };
}

export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7)) - 1 + delta;
  const ny = y + Math.floor(m / 12);
  const nm = ((m % 12) + 12) % 12;
  return `${ny}-${pad(nm + 1)}`;
}

/** Lista de meses terminando em `end`, em ordem cronológica. */
export function lastMonths(end: MonthKey, count: number): MonthKey[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(end, i - count + 1));
}

/** Número de meses entre dois meses (b - a). */
export function monthDiff(a: MonthKey, b: MonthKey): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function inRange(date: ISODate | null | undefined, range: DateRange): boolean {
  return !!date && date >= range.from && date <= range.to;
}

/** "2026-10-21" -> "21/10/2026" */
export function formatDateBR(date: ISODate | null | undefined): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** "21/10/2026" -> "2026-10-21" (ou null). */
export function parseDateBR(s: string): ISODate | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isISODate(iso) ? iso : null;
}

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-10" -> "Outubro de 2026" */
export function formatMonthLong(key: MonthKey): string {
  const name = MONTHS[Number(key.slice(5, 7)) - 1];
  return `${name[0].toUpperCase()}${name.slice(1)} de ${key.slice(0, 4)}`;
}

/** "2026-10" -> "out/26" */
export function formatMonthShort(key: MonthKey): string {
  return `${MONTHS_SHORT[Number(key.slice(5, 7)) - 1]}/${key.slice(2, 4)}`;
}

/** "21 out" — para listas compactas */
export function formatDayMonth(date: ISODate): string {
  return `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1]}`;
}
