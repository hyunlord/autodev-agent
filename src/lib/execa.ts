// execa 모듈을 lazy load하는 싱글톤 래퍼
let _execa: typeof import('execa').execa | null = null;

export async function getExeca() {
  if (!_execa) _execa = (await import('execa')).execa;
  return _execa;
}
