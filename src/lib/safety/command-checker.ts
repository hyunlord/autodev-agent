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
