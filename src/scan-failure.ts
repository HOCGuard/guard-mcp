// Hguard-2578: o auditor devolve no status de um job que falhou um código
// estável (failure.code) e, quando o texto foi escrito por ele, um detalhe.
// Aqui o código vira motivo e próximo passo que o agente consegue repassar.

export interface ScanFailure {
  code: string;
  detail?: string;
}

export interface FailureExplanation {
  reason: string;
  motivo: string;
  next: string;
  /** false quando repetir sem mudar nada dá o mesmo resultado. */
  retry: boolean;
}

const EXPLICACOES: Record<string, Omit<FailureExplanation, 'reason'>> = {
  blocked_by_robots_txt: {
    motivo: 'O robots.txt do site proíbe robôs, e a varredura respeita essa regra.',
    next: 'Se o site é seu, libere o robô do HOC Guard no robots.txt (User-agent: HOC-ConsentAuditor e Allow: /) e varra de novo. Repetir sem mudar o robots.txt dá o mesmo resultado.',
    retry: false,
  },
  robots_unreachable: {
    motivo: 'Não deu para ler o robots.txt do site agora.',
    next: 'Tente de novo em alguns minutos.',
    retry: true,
  },
  site_unreachable: {
    motivo: 'O site não respondeu ao navegador da varredura (fora do ar, endereço errado ou bloqueio de rede).',
    next: 'Confira se a URL abre no navegador e tente de novo.',
    retry: true,
  },
  timeout: {
    motivo: 'O site demorou demais para carregar e a varredura passou do tempo.',
    next: 'Tente de novo. Se repetir, varra uma página mais leve do mesmo site.',
    retry: true,
  },
  captcha_blocked: {
    motivo: 'O site mostrou um desafio anti-robô e a varredura não passou dele.',
    next: 'Se o site é seu, libere o robô do HOC Guard no serviço anti-robô e varra de novo.',
    retry: false,
  },
  redirected_off_site: {
    motivo: 'O endereço redireciona para outro domínio.',
    next: 'Varra o endereço final, para onde o site redireciona.',
    retry: false,
  },
  cancelled: {
    motivo: 'A varredura foi cancelada.',
    next: 'Inicie outra com guard_scan_site se ainda precisar.',
    retry: true,
  },
};

const PADRAO: Omit<FailureExplanation, 'reason'> = {
  motivo: 'A varredura falhou por um problema do nosso lado.',
  next: 'Tente de novo em alguns minutos. Se repetir, abra uma issue em https://github.com/HOCGuard/guard-mcp/issues com o scan_id.',
  retry: true,
};

export function explainFailure(failure: ScanFailure | undefined): FailureExplanation {
  const code = failure?.code ?? 'internal_error';
  const base = EXPLICACOES[code] ?? PADRAO;
  // O detalhe vem do auditor e traz o domínio; vale mais que o texto genérico.
  const motivo = failure?.detail ? `${base.motivo} (${failure.detail.replace(/\s+/g, ' ').trim().slice(0, 200)})` : base.motivo;
  return { reason: code, motivo, next: base.next, retry: base.retry };
}

export function failureMessage(scanId: string, failure: ScanFailure | undefined): string {
  const e = explainFailure(failure);
  return `A varredura ${scanId} falhou. ${e.motivo} ${e.next}`;
}
