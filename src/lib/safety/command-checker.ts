const DESTRUCTIVE_PATTERNS = [
  /rm\s+(-rf|-r)\s+\//,           // rm -rf /
  /rm\s+(-rf|-r)\s+~\//,          // rm -rf ~/
  /rm\s+(-rf|-r)\s+\.\.\//,       // rm -rf ../
  /git\s+push\s+.*--force/,        // git push --force
  /git\s+push\s+-f/,               // git push -f
  /git\s+reset\s+--hard/,          // git reset --hard
  /chmod\s+777/,                   // chmod 777
  /mkfs\./,                        // mkfs (format disk)
  /dd\s+if=/,                      // dd (disk destroyer)
  />\s*\/dev\/sd/,                 // write to disk device
  /curl.*\|\s*sh/,                 // curl | sh (pipe to shell)
  /curl.*\|\s*bash/,               // curl | bash
  /wget.*\|\s*sh/,                 // wget | sh
  /npm\s+publish/,                 // npm publish (accidental publish)
  /docker\s+system\s+prune/,       // docker system prune
  /env\s+\|/,                      // 환경 변수 덤프
  /printenv/,                      // 환경 변수 출력
  /echo\s+\$[A-Z_]*KEY/,          // API 키 출력 시도
  /echo\s+\$[A-Z_]*SECRET/,       // 시크릿 출력 시도
  /echo\s+\$[A-Z_]*TOKEN/,        // 토큰 출력 시도
  /echo\s+\$[A-Z_]*PASSWORD/,     // 패스워드 출력 시도
  />\s*\/etc\//,                   // /etc/ 쓰기
  /sudo\s+/,                      // sudo 사용
  /pkill\s+-9/,                   // 프로세스 강제 종료
  /killall/,                      // 프로세스 일괄 종료
];

const WORKSPACE_ESCAPE_PATTERNS = [
  /cd\s+\.\.\//,                   // cd ../
  /cat\s+\/etc\//,                 // cat /etc/
  /cat\s+~\//,                     // cat ~/
];

export interface CommandCheckResult {
  safe: boolean;
  warnings: string[];
}

export function checkCommand(command: string): CommandCheckResult {
  const warnings: string[] = [];

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      warnings.push(`Destructive command detected: ${command.slice(0, 100)}`);
    }
  }

  for (const pattern of WORKSPACE_ESCAPE_PATTERNS) {
    if (pattern.test(command)) {
      warnings.push(`Workspace escape detected: ${command.slice(0, 100)}`);
    }
  }

  return {
    safe: warnings.length === 0,
    warnings,
  };
}

// ─── Stage-specific patterns ────────────────────────

const WRITE_PATTERNS = [
  /\bmkdir\b/, /\btouch\b/, /\brm\b/, /\bmv\b/, /\bcp\b/,
  /\bnpm\s+install\b/, /\bpnpm\s+(add|install)\b/, /\byarn\s+add\b/,
  /\bgit\s+add\b/, /\bgit\s+commit\b/, /\bgit\s+push\b/,
];

const FILE_MODIFY_PATTERNS = [
  />>?/, /\bsed\s+-i\b/, /\btee\b/,
];

/**
 * 파이프라인 단계별 명령어 검사.
 * Planning: read-only만 허용 (ls, cat, find, git log, git diff)
 * Coding: write 허용 (mkdir, touch, npm install 등)
 * Verification: read-only + 실행만 (npm test, 서버 시작 등)
 */
export function checkCommandForStage(
  command: string,
  stage: 'planning' | 'coding' | 'verification',
): CommandCheckResult {
  // 공통 destructive 검사 먼저
  const base = checkCommand(command);
  if (!base.safe) return base;

  const warnings: string[] = [];
  const normalized = command.replace(/\s+/g, ' ').trim();

  if (stage === 'planning') {
    for (const p of WRITE_PATTERNS) {
      if (p.test(normalized)) {
        warnings.push(`Planning stage: write command blocked — ${normalized.slice(0, 100)}`);
      }
    }
    for (const p of FILE_MODIFY_PATTERNS) {
      if (p.test(normalized)) {
        warnings.push(`Planning stage: file modification blocked — ${normalized.slice(0, 100)}`);
      }
    }
  }

  if (stage === 'verification') {
    // 파일 수정 차단 (rm, mv, cp, mkdir, touch, sed -i)
    const verifyWriteBlocked = [
      /\bmkdir\b/, /\btouch\b/, /\brm\b/, /\bmv\b/, /\bcp\b/, /\bsed\s+-i\b/,
    ];
    for (const p of verifyWriteBlocked) {
      if (p.test(normalized)) {
        warnings.push(`Verification stage: file modification blocked — ${normalized.slice(0, 100)}`);
      }
    }
    // git 쓰기 차단
    const gitWriteBlocked = [/\bgit\s+add\b/, /\bgit\s+commit\b/, /\bgit\s+push\b/];
    for (const p of gitWriteBlocked) {
      if (p.test(normalized)) {
        warnings.push(`Verification stage: git write blocked — ${normalized.slice(0, 100)}`);
      }
    }
  }

  return { safe: warnings.length === 0, warnings };
}

/**
 * Check if a command stays within the allowed project directory
 */
export function isWithinWorkspace(command: string, _projectDir: string): boolean {
  // Basic check — real sandboxing would need OS-level support
  const normalized = command.replace(/\s+/g, ' ').trim();

  // Flags that try to escape
  if (normalized.includes('/../') || normalized.startsWith('cd /')) {
    return false;
  }

  return true;
}
