import { NextResponse, type NextRequest } from "next/server";
import { getEverything } from "@/lib/data/queries";
import { todayISO } from "@/lib/finance/dates";

export const dynamic = "force-dynamic";

const TYPE: Record<string, string> = { income: "Receita", expense: "Despesa", refund: "Estorno" };
const STATUS: Record<string, string> = { paid: "Efetivado", pending: "Pendente", cancelled: "Cancelado" };

function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  // proteção contra injeção de fórmulas no Excel/Sheets
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const brl = (cents: unknown) => (Number(cents) / 100).toFixed(2).replace(".", ",");
const br = (d: unknown) => (d ? String(d).split("-").reverse().join("/") : "");

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get("formato") ?? "json";
  const data = await getEverything();
  const stamp = todayISO();

  if (format === "csv") {
    const acc = new Map(data.accounts.map((a) => [a.id, a.name]));
    const cat = new Map(data.categories.map((c) => [c.id, c.name]));
    const header = ["Data", "Pago em", "Tipo", "Descrição", "Categoria", "Conta", "Valor (R$)", "Situação", "Forma de pagamento", "Observações"];
    const rows = [
      ...data.transactions.map((t) => [
        br(t.date), br(t.paid_at), TYPE[String(t.type)], t.description, cat.get(t.category_id) ?? "", acc.get(t.account_id) ?? "",
        (t.type === "expense" ? "-" : "") + brl(t.amount_cents), STATUS[String(t.status)], t.payment_method, t.notes ?? "",
      ]),
      ...data.transfers.map((t) => [
        br(t.date), br(t.paid_at), "Transferência", t.description, "", `${acc.get(t.from_account_id)} → ${acc.get(t.to_account_id)}`,
        brl(t.amount_cents), STATUS[String(t.status)], "", t.notes ?? "",
      ]),
    ].sort((a, b) => String(a[0]).split("/").reverse().join("").localeCompare(String(b[0]).split("/").reverse().join("")));
    // ; como separador e BOM para abrir corretamente no Excel em português
    const csv = "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="meu-financeiro-lancamentos-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const body = JSON.stringify({ app: "meu-financeiro", schema: "fase1", exportedAt: new Date().toISOString(), data }, null, 2);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="meu-financeiro-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
