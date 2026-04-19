const CODES = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  reset: '\x1b[0m',
} as const;

function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return !!process.stdout.isTTY;
}

function c(code: string, text: string): string {
  return supportsColor() ? `${code}${text}${CODES.reset}` : text;
}

export const colors = {
  success: (s: string) => c(CODES.green, s),
  error: (s: string) => c(CODES.red, s),
  warn: (s: string) => c(CODES.yellow, s),
  dim: (s: string) => c(CODES.gray, s),
  bold: (s: string) => c(CODES.bold, s),
};
