#!/usr/bin/env node
import { run } from '../src/cli.mjs';

run(process.argv.slice(2)).then(
  (out) => { if (out) process.stdout.write(out.endsWith('\n') ? out : `${out}\n`); },
  (err) => { console.error(`compiler-ci: ${err.message}`); process.exit(2); },
);
