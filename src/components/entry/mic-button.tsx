"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* Web Speech API (Chrome/Android, Safari/iPhone). Reconhecimento feito pelo navegador. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function getRecognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Permita o uso do microfone para lançar por voz.",
  "service-not-allowed": "O reconhecimento de voz não está disponível aqui. Use o microfone do teclado.",
  "audio-capture": "Nenhum microfone encontrado.",
  network: "Sem conexão para reconhecer a voz.",
};

/**
 * Botão de microfone: escuta em português, mostra o texto enquanto você fala
 * (onPartial) e entrega a frase final (onFinal). Some se o navegador não suportar
 * — nesse caso o microfone do próprio teclado continua funcionando.
 */
export function MicButton({
  onPartial,
  onFinal,
  className,
  size = "md",
}: {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");

  useEffect(() => {
    setSupported(!!getRecognition());
    return () => rec.current?.abort();
  }, []);

  if (!supported) return null;

  function start() {
    const Ctor = getRecognition();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "pt-BR";
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    finalText.current = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript;
        else interim += res[0].transcript;
      }
      onPartial?.((finalText.current + interim).trim());
    };
    r.onerror = (e) => {
      if (e.error !== "no-speech" && e.error !== "aborted") toast.error(ERRORS[e.error] ?? "Não consegui ouvir. Tente de novo.");
    };
    r.onend = () => {
      setListening(false);
      const text = finalText.current.trim();
      if (text) onFinal(text);
    };
    rec.current = r;
    try {
      r.start();
      setListening(true);
      if ("vibrate" in navigator) navigator.vibrate?.(20);
    } catch {
      setListening(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => (listening ? rec.current?.stop() : start())}
      aria-label={listening ? "Parar e usar o que foi dito" : "Falar o lançamento"}
      aria-pressed={listening}
      title={listening ? "Parar" : "Falar o lançamento"}
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-xl transition",
        size === "sm" ? "size-8" : "size-10",
        listening ? "bg-negative text-white" : "bg-muted text-foreground hover:bg-accent",
        className,
      )}
    >
      {listening && <span className="absolute inset-0 animate-ping rounded-xl bg-negative/40" aria-hidden />}
      {listening ? <Square className="relative size-3.5 fill-current" /> : <Mic className="size-4" />}
    </button>
  );
}
