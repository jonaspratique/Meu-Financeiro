"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { BellOff, BellRing, Loader2, Send, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPushPublicKey, removePushSubscription, savePushSubscription, sendTestPush } from "@/lib/actions/push";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function base64ToBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

async function registration() {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export function NotificationsCard({ devices }: { devices: number }) {
  const [state, setState] = useState<State>("loading");
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) return setState(isIOS() && !isStandalone() ? "ios-install" : "unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  function enable() {
    start(async () => {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        toast.error("Permissão de notificação não concedida.");
        return;
      }
      const key = await getPushPublicKey();
      if (!key.ok || !key.data) {
        toast.error(key.ok ? "Chave de notificação indisponível." : key.error);
        return;
      }
      try {
        const reg = await registration();
        await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(key.data) }));
        const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        const saved = await savePushSubscription({ endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent.slice(0, 300) });
        if (!saved.ok) {
          toast.error(saved.error);
          return;
        }
        setState("on");
        const test = await sendTestPush();
        toast.success(test.ok ? "Notificações ativadas. Enviamos um teste." : "Notificações ativadas");
      } catch (e) {
        console.error(e);
        toast.error("Não foi possível ativar neste navegador.");
      }
    });
  }

  function disable() {
    start(async () => {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe().catch(() => {});
      }
      setState("off");
      toast.success("Notificações desativadas neste aparelho");
    });
  }

  function test() {
    start(async () => {
      const r = await sendTestPush();
      if (r.ok) toast.success(r.message ?? "Enviado");
      else toast.error(r.error);
    });
  }

  return (
    <div className="grid gap-3 text-sm">
      <p className="text-muted-foreground">
        Todo dia às 9h: fatura que vence amanhã, saldo que não cobre o que vai sair da conta, contas a pagar do dia seguinte, receitas
        previstas e faturas vencidas sem pagamento registrado.
      </p>

      {state === "loading" && <p className="text-muted-foreground">Verificando este aparelho…</p>}

      {state === "ios-install" && (
        <div className="flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5">
          <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            No iPhone, as notificações só funcionam pelo app instalado: no Safari toque em <strong>Compartilhar</strong> →{" "}
            <strong>Adicionar à Tela de Início</strong>, abra o Meu Financeiro pelo ícone e volte aqui.
          </p>
        </div>
      )}
      {state === "unsupported" && <p className="text-muted-foreground">Este navegador não aceita notificações. Tente o Chrome, o Edge ou o app instalado.</p>}
      {state === "denied" && (
        <p className="text-muted-foreground">
          As notificações estão bloqueadas para este site. Libere nas configurações do navegador (ou do iPhone, em Notificações → Financeiro) e
          recarregue a página.
        </p>
      )}

      {state === "off" && (
        <Button onClick={enable} disabled={pending} className="justify-self-start">
          {pending ? <Loader2 className="animate-spin" /> : <BellRing />} Ativar notificações neste aparelho
        </Button>
      )}
      {state === "on" && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={test} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Send />} Enviar teste
          </Button>
          <Button variant="ghost" onClick={disable} disabled={pending}>
            <BellOff /> Desativar neste aparelho
          </Button>
        </div>
      )}
      {devices > 0 && (
        <p className="text-xs text-muted-foreground">
          {devices === 1 ? "1 aparelho recebe" : `${devices} aparelhos recebem`} as notificações.
        </p>
      )}
    </div>
  );
}
