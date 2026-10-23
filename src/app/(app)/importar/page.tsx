import { PageHeader } from "@/components/common/page-header";
import { getAccounts, getCards, getCategories } from "@/lib/data/queries";
import { getQuickHints } from "@/lib/actions/quick";
import { todayISO } from "@/lib/finance/dates";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "Importar CSV" };

export default async function ImportarPage() {
  const [accounts, cards, categories, history] = await Promise.all([getAccounts(), getCards(), getCategories(), getQuickHints()]);
  return (
    <>
      <PageHeader
        title="Importar CSV"
        description="Extrato do banco, fatura do cartão ou o CSV exportado pelo próprio app. Nada é gravado antes de você conferir."
      />
      <ImportWizard
        today={todayISO()}
        accounts={accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name }))}
        cards={cards.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }))}
        categories={categories.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name, kind: c.kind }))}
        history={history}
      />
    </>
  );
}
