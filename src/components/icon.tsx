import {
  Banknote, Briefcase, Car, CircleEllipsis, GraduationCap, HeartPulse, Home, Landmark, Laptop, PartyPopper,
  PiggyBank, Plane, PlusCircle, Repeat, Rocket, RotateCcw, Shield, ShoppingBag, ShoppingCart, Smartphone,
  Sparkles, Tag, TrendingUp, Utensils, Wallet, Zap, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  banknote: Banknote, briefcase: Briefcase, car: Car, "circle-ellipsis": CircleEllipsis,
  "graduation-cap": GraduationCap, "heart-pulse": HeartPulse, home: Home, landmark: Landmark, laptop: Laptop,
  "party-popper": PartyPopper, "piggy-bank": PiggyBank, plane: Plane, "plus-circle": PlusCircle, repeat: Repeat,
  rocket: Rocket, "rotate-ccw": RotateCcw, shield: Shield, "shopping-bag": ShoppingBag, "shopping-cart": ShoppingCart,
  smartphone: Smartphone, sparkles: Sparkles, tag: Tag, "trending-up": TrendingUp, utensils: Utensils,
  wallet: Wallet, zap: Zap,
};

export function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Tag;
  return <Icon className={className} aria-hidden />;
}

/** Ícone em "pastilha" colorida, usado em listas. */
export function IconBadge({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl", className)}
      style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}
    >
      <DynamicIcon name={name} className="size-[18px]" />
    </span>
  );
}

export const PALETTE = [
  "#6366f1", "#0ea5e9", "#10b981", "#84cc16", "#f59e0b", "#f97316",
  "#ef4444", "#ec4899", "#a855f7", "#8b5cf6", "#14b8a6", "#64748b",
];
