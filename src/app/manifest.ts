import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Meu Financeiro",
    short_name: "Financeiro",
    description: "Controle das minhas finanças pessoais",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#86deb5",
    theme_color: "#1f2230",
    shortcuts: [
      { name: "Novo lançamento", short_name: "Lançar", url: "/?novo=1", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Movimentações", url: "/movimentacoes", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Planejamento", url: "/planejamento", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
