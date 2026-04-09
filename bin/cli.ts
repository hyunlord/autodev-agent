#!/usr/bin/env npx tsx
import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { intro, text, confirm, outro, isCancel, spinner } from '@clack/prompts';

const DATA_DIR = join(process.cwd(), '.autodev');
const ENV_PATH = join(DATA_DIR, '.env');

const program = new Command()
  .name('autodev-agent')
  .description('Universal AI Development Agent Orchestrator')
  .version('0.1.0');

program
  .command('start')
  .description('Start the AutoDev dashboard')
  .option('-p, --port <port>', 'Port number', '3000')
  .action(async (opts) => {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
      mkdirSync(join(DATA_DIR, 'screenshots'), { recursive: true });
    }

    if (!existsSync(ENV_PATH)) {
      await runSetupWizard();
    }

    loadEnv();

    const { runMigrations } = await import('../src/lib/db/migrate');
    runMigrations();

    const { execa } = await import('execa');
    const proc = execa('npx', ['next', 'start', '-p', opts.port], {
      stdio: 'inherit',
      env: { ...process.env, AUTODEV_DATA_DIR: DATA_DIR },
    });
    await proc;
  });

program
  .command('dev')
  .description('Start in development mode')
  .action(async () => {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
      mkdirSync(join(DATA_DIR, 'screenshots'), { recursive: true });
    }
    if (!existsSync(ENV_PATH)) {
      await runSetupWizard();
    }
    loadEnv();

    const { execa } = await import('execa');
    await execa('npx', ['next', 'dev'], { stdio: 'inherit' });
  });

program.parse();

async function runSetupWizard(): Promise<void> {
  intro('AutoDev Agent — First Run Setup');

  const openrouterKey = await text({
    message: 'OpenRouter API Key (optional, for VLM visual analysis):',
    placeholder: 'sk-or-... (press Enter to skip)',
  });
  if (isCancel(openrouterKey)) process.exit(0);

  const projectDir = await text({
    message: 'Default project directory:',
    placeholder: process.cwd(),
    initialValue: process.cwd(),
  });

  let envContent = '';
  if (openrouterKey && !isCancel(openrouterKey) && String(openrouterKey).trim()) {
    envContent += `OPENROUTER_API_KEY=${openrouterKey}\n`;
  }
  if (projectDir && !isCancel(projectDir)) {
    envContent += `AUTODEV_DEFAULT_PROJECT_DIR=${projectDir}\n`;
  }

  writeFileSync(ENV_PATH, envContent);
  outro('Setup complete! Starting AutoDev...');
}

function loadEnv(): void {
  if (existsSync(ENV_PATH)) {
    const content = readFileSync(ENV_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      const [key, ...rest] = line.split('=');
      if (key && rest.length > 0) {
        process.env[key.trim()] = rest.join('=').trim();
      }
    }
  }
}
