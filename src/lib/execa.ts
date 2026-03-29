let _execa: typeof import('execa').execa | null = null;

export async function getExeca() {
  if (!_execa) _execa = (await import('execa')).execa;
  return _execa;
}
