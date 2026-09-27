import type { SourceFile } from './trackers.ts';
import { codeOf } from './ast.ts';

// Detecção de transferência internacional de dados (LGPD Cap. V, art. 33). Lê o
// código e sinaliza serviços que recebem dado pessoal fora do Brasil. Estático,
// nada sai da máquina. Nenhum outro scanner de privacidade olha isso.

export interface TransferRule {
  id: string;
  service: string;
  country: string;
  patterns: RegExp[];
}

export const TRANSFER_RULES: TransferRule[] = [
  { id: 'google-fonts', service: 'Google Fonts', country: 'EUA', patterns: [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /next\/font\/google/] },
  { id: 'google', service: 'Google (Analytics/Ads/GTM)', country: 'EUA', patterns: [/googletagmanager\.com/, /google-analytics\.com/, /doubleclick\.net/] },
  { id: 'meta', service: 'Meta', country: 'EUA', patterns: [/connect\.facebook\.net/, /facebook\.com\/tr/] },
  { id: 'aws', service: 'Amazon Web Services', country: 'EUA', patterns: [/amazonaws\.com/, /@aws-sdk\//] },
  { id: 'vercel', service: 'Vercel', country: 'EUA', patterns: [/@vercel\/(analytics|kv|postgres|blob)/, /vercel\.live/] },
  { id: 'cloudflare', service: 'Cloudflare', country: 'EUA', patterns: [/cloudflare(insights|\.com)/, /challenges\.cloudflare\.com/] },
  { id: 'openai', service: 'OpenAI', country: 'EUA', patterns: [/api\.openai\.com/, /['"]openai['"]/] },
  { id: 'stripe', service: 'Stripe', country: 'EUA', patterns: [/js\.stripe\.com/, /api\.stripe\.com/, /@stripe\//] },
  { id: 'sentry', service: 'Sentry', country: 'EUA (Funcahashi/Alemanha conforme região)', patterns: [/@sentry\//, /sentry\.io/, /ingest\.sentry/] },
  { id: 'intercom', service: 'Intercom', country: 'EUA', patterns: [/widget\.intercom\.io/, /@intercom\//] },
  { id: 'mailchimp', service: 'Mailchimp', country: 'EUA', patterns: [/chimpstatic\.com/, /list-manage\.com/, /mailchimp/i] },
  { id: 'sendgrid', service: 'SendGrid', country: 'EUA', patterns: [/@sendgrid\//, /api\.sendgrid\.com/] },
  { id: 'supabase', service: 'Supabase', country: 'depende da região do projeto', patterns: [/@supabase\//, /supabase\.co/] },
  { id: 'segment', service: 'Segment', country: 'EUA', patterns: [/cdn\.segment\.com/, /@segment\//] },
];

export interface DetectedTransfer {
  id: string;
  service: string;
  country: string;
  files: string[];
}

export function detectTransfers(files: SourceFile[]): DetectedTransfer[] {
  const found = new Map<string, DetectedTransfer>();
  for (const file of files) {
    for (const rule of TRANSFER_RULES) {
      const code = codeOf(file);
      if (!rule.patterns.some((p) => p.test(code))) continue;
      const entry = found.get(rule.id) ?? { id: rule.id, service: rule.service, country: rule.country, files: [] };
      if (!entry.files.includes(file.path)) entry.files.push(file.path);
      found.set(rule.id, entry);
    }
  }
  return [...found.values()];
}
