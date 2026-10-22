import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseEnv } from "./env";

const PUBLIC_PATHS = ["/login"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  let env: { url: string; key: string };
  try {
    env = supabaseEnv();
  } catch {
    // Mensagem clara em vez de "Internal Server Error" quando o deploy está sem as variáveis
    return new NextResponse(
      "Meu Financeiro: configuração incompleta. Defina NEXT_PUBLIC_SUPABASE_URL e " +
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY nas variáveis de ambiente da Vercel e faça um novo deploy.",
      { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }
  const { url, key } = env;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Não colocar código entre a criação do client e getClaims():
  // é aqui que a sessão é validada e renovada.
  const { data } = await supabase.auth.getClaims();
  const isLoggedIn = !!data?.claims?.sub;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!isLoggedIn && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    return NextResponse.redirect(login);
  }

  if (isLoggedIn && path === "/login") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  return response;
}
