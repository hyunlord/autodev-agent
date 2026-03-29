import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

export async function POST() {
  try {
    const platform = process.platform;
    let selectedPath = '';

    if (platform === 'darwin') {
      // macOS: native folder picker via osascript
      const result = execSync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select project directory")'`,
        { timeout: 60_000, encoding: 'utf-8' },
      ).trim();
      selectedPath = result.replace(/\/$/, ''); // Remove trailing slash
    } else if (platform === 'linux') {
      // Linux: try zenity, then kdialog
      try {
        selectedPath = execSync(
          'zenity --file-selection --directory --title="Select project directory"',
          { timeout: 60_000, encoding: 'utf-8' },
        ).trim();
      } catch {
        selectedPath = execSync(
          'kdialog --getexistingdirectory ~',
          { timeout: 60_000, encoding: 'utf-8' },
        ).trim();
      }
    } else {
      return NextResponse.json({ error: 'Directory picker not supported on this platform' }, { status: 501 });
    }

    if (!selectedPath || !existsSync(selectedPath)) {
      return NextResponse.json({ error: 'No directory selected' }, { status: 400 });
    }

    return NextResponse.json({ path: selectedPath });
  } catch {
    // User cancelled the dialog
    return NextResponse.json({ error: 'Cancelled' }, { status: 400 });
  }
}
