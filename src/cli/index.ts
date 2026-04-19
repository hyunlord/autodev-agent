import { Command } from 'commander';
import { validateCommand } from './commands/adpl-validate';

const program = new Command()
  .name('autodev')
  .description('AutoDev CLI')
  .helpOption('-h, --help', '도움말 표시');

program
  .command('validate')
  .description('ADPL YAML 파일 검증')
  .argument('<paths...>', '검증할 YAML 파일 경로 (glob 지원)')
  .option('--format <format>', '출력 형식 (pretty|json)', 'pretty')
  .option('--quiet', '출력 없이 exit code 만 반환', false)
  .action(async (paths: string[], opts: { format: string; quiet: boolean }) => {
    await validateCommand(paths, {
      format: opts.format === 'json' ? 'json' : 'pretty',
      quiet: opts.quiet,
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
});
