import {
  ArrowLeftRight, BarChart3, CalendarRange, LayoutDashboard, PiggyBank, Settings, WalletCards, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", short: "Início", icon: LayoutDashboard },
  { href: "/movimentacoes", label: "Movimentações", short: "Lançamentos", icon: ArrowLeftRight },
  { href: "/contas", label: "Contas e cartões", short: "Contas", icon: WalletCards },
  { href: "/reservas", label: "Reservas", short: "Reservas", icon: PiggyBank },
  { href: "/planejamento", label: "Planejamento", short: "Planejamento", icon: CalendarRange },
  { href: "/relatorios", label: "Relatórios", short: "Relatórios", icon: BarChart3 },
];

export const SETTINGS: NavItem = { href: "/configuracoes", label: "Configurações", short: "Ajustes", icon: Settings };

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
