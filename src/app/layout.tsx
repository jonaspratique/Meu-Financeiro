import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { themeScript } from "@/components/shell/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Meu Financeiro", template: "%s · Meu Financeiro" },
  description: "Controle das minhas finanças pessoais",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Financeiro", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fb" },
    { media: "(prefers-color-scheme: dark)", color: "#121318" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <Toaster position="top-center" richColors closeButton toastOptions={{ className: "font-sans" }} />
      </body>
    </html>
  );
}
