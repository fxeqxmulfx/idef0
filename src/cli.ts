#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname } from 'node:path';
import { parseArgs } from 'node:util';
import { formatDiagnostic, Idef0Error, type Diagnostic } from './diagnostics.ts';
import { check, compile } from './index.ts';
import { PAGE_SIZES, type PageSize } from './model.ts';

const HELP = `Usage: idef0 <model.idef0> [options]

Compiles an IDEF0 model written in the idef0 DSL to a PDF with one page per diagram
(A-0 context diagram first, then every decomposition in node order).

Options:
  -o, --output <file>  PDF to write (default: the input name with .pdf)
      --page <size>    page size: ${PAGE_SIZES.join(', ')} (default: the model's, else A4)
      --font <file>    TrueType/OpenType font for all text (for scripts Helvetica lacks)
      --check          check the model and report problems, but write nothing
  -h, --help           show this help
  -v, --version        show the version`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return pkg.version;
}

function report(diagnostics: readonly Diagnostic[], source: string, file: string): void {
  for (const d of diagnostics) console.error(`${formatDiagnostic(d, source, file)}\n`);
}

async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: 'string', short: 'o' },
        page: { type: 'string' },
        font: { type: 'string' },
        check: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    console.error(`idef0: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = args;
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  if (values.version) {
    console.log(version());
    return 0;
  }
  if (positionals.length !== 1) {
    console.error(`idef0: expected exactly one input file\n\n${HELP}`);
    return 2;
  }
  let page: PageSize | undefined;
  if (values.page !== undefined) {
    page = PAGE_SIZES.find((p) => p.toLowerCase() === values.page!.toLowerCase());
    if (!page) {
      console.error(`idef0: unknown page size "${values.page}" (use ${PAGE_SIZES.join(', ')})`);
      return 2;
    }
  }

  const input = positionals[0]!;
  let source: string;
  try {
    source = await readFile(input, 'utf8');
  } catch (e) {
    console.error(`idef0: cannot read ${input}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
    return 1;
  }

  try {
    if (values.check) {
      const { model, warnings } = check(source);
      report(warnings, source, input);
      console.error(`${input}: ok, ${model.diagrams.length} diagram${model.diagrams.length === 1 ? '' : 's'}${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}`);
      return 0;
    }
    const output = values.output ?? `${input.slice(0, input.length - extname(input).length) || basename(input)}.pdf`;
    const result = await compile(source, { page, font: values.font, baseDir: dirname(input) });
    report(result.warnings, source, input);
    await writeFile(output, result.pdf);
    const n = result.model.diagrams.length;
    console.error(`wrote ${output} (${n} diagram${n === 1 ? '' : 's'})`);
    return 0;
  } catch (e) {
    if (e instanceof Idef0Error) {
      report(e.diagnostics, source, input);
      const errors = e.diagnostics.filter((d) => d.severity === 'error').length;
      console.error(`${input}: ${errors} error${errors === 1 ? '' : 's'}`);
      return 1;
    }
    console.error(`idef0: ${(e as Error).message}`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
