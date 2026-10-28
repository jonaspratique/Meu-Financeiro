import Link from "next/link";
import { Download, FileSpreadsheet, FileUp, LogOut, ShieldCheck } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/page-header";
import { ThemeSwitcher } from "@/components/shell/theme";
import { getCategories } from "@/lib/data/queries";
import { requireUser } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { CategoryManager } from "./category-manager";
import { NotificationsCard } from "./notifications-card";
import { countPushDevices } from "@/lib/actions/push";

export const metadata = { title: "Configurações" };

export default async function ConfiguracoesPage() {
  const { user } = await requireUser();
  const [categories, devices] = await Promise.all([getCategories(), countPushDevices()]);
  return (
    <>
      <PageHeader title="Configurações" description={user.email} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="pb-2 lg:row-span-3">
          <CardHeader title="Categorias" description="Arquivar esconde dos formulários sem perder o histórico." />
          <div className="mt-4">
            <CategoryManager categories={categories} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Notificações no celular" description="Avisos de vencimento e saldo, sem precisar abrir o app." />
          <CardBody>
            <NotificationsCard devices={devices} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Aparência" />
          <CardBody>
            <ThemeSwitcher />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Importar e exportar" description="Seus dados são seus. Exporte quando quiser." />
          <CardBody className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" asChild>
              <a href="/api/export?formato=json" download>
                <Download /> Backup completo (JSON)
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/export?formato=csv" download>
                <FileSpreadsheet /> Lançamentos (CSV)
              </a>
            </Button>
            <Button variant="outline" asChild className="sm:col-span-2">
              <Link href="/importar">
                <FileUp /> Importar extrato ou fatura (CSV)
              </Link>
            </Button>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Recomendado: baixe o backup JSON uma vez por mês e guarde em local seguro. O procedimento de restauração está no
              README do projeto.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Segurança" />
          <CardBody className="grid gap-3 text-sm">
            <p className="flex items-start gap-2 text-muted-foreground">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" />
              Dados protegidos por Row Level Security: cada registro só é acessível pelo seu usuário. Nenhuma senha bancária é armazenada.
            </p>
            <form action={signOut}>
              <Button variant="outline">
                <LogOut /> Sair desta sessão
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
