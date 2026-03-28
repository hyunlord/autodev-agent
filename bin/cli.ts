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

  const anthropicKey = await text({
    message: 'Anthropic API Key (required for Claude Code + VLM):',
    placeholder: 'sk-ant-...',
    validate: (v) => {
      if (!v || !v.startsWith('sk-ant-')) return 'Must start with sk-ant-';
    },
  });
  if (isCancel(anthropicKey)) process.exit(0);

  const openaiKey = await text({
    message: 'OpenAI API Key (optional, for GPT-4o VLM):',
    placeholder: 'sk-...',
  });

  const projectDir = await text({
    message: 'Default project directory:',
    placeholder: process.cwd(),
    initialValue: process.cwd(),
  });

  let envContent = `ANTHROPIC_API_KEY=${anthropicKey}\n`;
  if (openaiKey && !isCancel(openaiKey)) {
    envContent += `OPENAI_API_KEY=${openaiKey}\n`;
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
