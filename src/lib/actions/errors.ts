import "server-only";

interface PgError {
  code?: string;
  message: string;
}

/** Traduz erros do banco para mensagens úteis, sem vazar detalhes internos. */
export function dbError(error: PgError | null | undefined): string {
  if (!error) return "Erro desconhecido.";
  switch (error.code) {
    case "P0001": // regras de negócio levantadas pelos triggers (já em português)
      return error.message;
    case "23505":
      return "Já existe um item com esse nome.";
    case "23503":
      return "Este item está sendo usado por outros registros e não pode ser removido.";
    case "23514":
      return "Os dados não passaram nas regras de validação.";
    case "42501":
      return "Acesso negado.";
    default:
      console.error("[db]", error.code, error.message);
      return "Não foi possível salvar. Tente novamente.";
  }
}
