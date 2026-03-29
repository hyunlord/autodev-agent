import { getExeca } from './execa';

export async function getModifiedFiles(cwd: string, diffRef?: string): Promise<string[]> {
  try {
    const execa = await getExeca();
    const files: string[] = [];

    if (diffRef) {
      const { stdout } = await execa('git', ['diff', '--name-only', diffRef], { cwd, reject: false });
      if (stdout.trim()) files.push(...stdout.split('\n').filter(Boolean));
    }

    // Unstaged changes to tracked files
    const { stdout: unstaged } = await execa('git', ['diff', '--name-only'], { cwd, reject: false });
    files.push(...unstaged.split('\n').filter(Boolean));

    // Staged changes
    const { stdout: staged } = await execa('git', ['diff', '--name-only', '--cached'], { cwd, reject: false });
    files.push(...staged.split('\n').filter(Boolean));

    // New untracked files
    const { stdout: untracked } = await execa('git', ['ls-files', '--others', '--exclude-standard'], { cwd, reject: false });
    files.push(...untracked.split('\n').filter(Boolean));

    return [...new Set(files)];
  } catch {
    return [];
  }
}
