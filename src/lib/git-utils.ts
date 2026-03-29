import { getExeca } from './execa';

export async function getModifiedFiles(cwd: string, diffRef?: string): Promise<string[]> {
  try {
    const execa = await getExeca();
    if (diffRef) {
      const { stdout } = await execa('git', ['diff', '--name-only', diffRef], { cwd, reject: false });
      if (stdout.trim()) return stdout.split('\n').filter(Boolean);
    }
    const { stdout } = await execa('git', ['diff', '--name-only'], { cwd, reject: false });
    const staged = await execa('git', ['diff', '--name-only', '--cached'], { cwd, reject: false });
    return [...new Set([...stdout.split('\n'), ...staged.stdout.split('\n')].filter(Boolean))];
  } catch {
    return [];
  }
}
