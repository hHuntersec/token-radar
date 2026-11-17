// Token Radar, rewritten (Node 22, standard library only).
//
// The entry point reads the sealed snapshot from /input/snapshot.json (or --input
// <file|directory>), scores every pre-token protocol the watchlist's rule keeps with the model in
// lib/model.ts, writes the ranked board to /output/board.json, and copies this repository's
// dashboard/ and screenshots/ into /output. Last it writes /output/dossier.json, the summary the
// judge reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/
// app.css and dashboard/app.js read /output/data.js, which this program writes from the same
// board. The board it writes ranks by implied value: the watchlist's exclusion rule on every row,
// a value multiple per category from the snapshot's own tokenized peers, and a farm plan per
// protocol.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBoard, assembleRadar, dataModule, readSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DASH_LIMITS = { max_files: 400, max_bytes: 4_194_304 };

/** A fatal error: a message on stderr and an exit code, nothing written. */
function die(message: string, code: number): never {
  process.stderr.write(message + '\n');
  process.exit(code);
}

/** The value after `--name` (either `--name value` or `--name=value`), else the fallback. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--' + name && i + 1 < argv.length) return argv[i + 1]!;
    if (a.startsWith('--' + name + '=')) return a.slice(name.length + 3);
  }
  return fallback;
}

function main(): void {
  const inputArg = flagValue('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : path.join(inputArg, 'snapshot.json');
  if (!fs.existsSync(inputFile)) {
    die(
      'token radar: no snapshot at ' + inputFile + ': pass --input <snapshot.json|directory> or mount the sealed /input',
      2,
    );
  }
  const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snap = readSnapshot(fs.readFileSync(inputFile, 'utf8'));
  const { board, radar } = assembleRadar(snap);
  const problem = checkBoard(board, snap);
  if (problem !== null) die('token radar: the model wrote a board the gate refuses: ' + problem, 1);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  fs.writeFileSync(path.join(outDir, 'data.js'), dataModule(radar));

  const dashCopied = copyDir(path.join(REPO_ROOT, 'dashboard'), path.join(outDir, 'dashboard'));
  const shotsCopied = copyDir(path.join(REPO_ROOT, 'screenshots'), path.join(outDir, 'screenshots'));
  if (shotsCopied.length < 3) {
    die(
      'token radar: screenshots/ holds ' + shotsCopied.length + ' image' + (shotsCopied.length === 1 ? '' : 's') + ': hand in 3, the board, a detail view and a filtered view',
      1,
    );
  }
  for (const name of shotsCopied) {
    if (!SHOT_NAME.test(name)) {
      die('token radar: screenshots/' + name + ': a name is letters, digits and . _ -, 1 to 128 characters', 1);
    }
  }

  // The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
  fs.writeFileSync(
    path.join(outDir, 'dossier.json'),
    buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_LIMITS, dashboard: DASH_LIMITS }),
  );

  const summary = [
    'token radar: ' + snap.protocols.length + ' protocols, ' + snap.watchlist.length + ' on the watchlist, ' + board.length + ' rows scored (' + radar.early_size + ' early, ' + radar.live_size + ' live set aside)',
    'token radar: wrote ' + path.join(outDir, 'board.json') + ', ' + path.join(outDir, 'data.js') + ', ' + path.join(outDir, 'dashboard') + ' (' + dashCopied.length + ' files), ' + path.join(outDir, 'screenshots') + ' (' + shotsCopied.length + ' images) and ' + path.join(outDir, 'dossier.json'),
  ];
  process.stdout.write(summary.join('\n') + '\n');
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyDir(from: string, to: string): string[] {
  if (!fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of fs.readdirSync(from)) {
    if (name.charAt(0) === '.') continue;
    const src = path.join(from, name);
    if (!fs.statSync(src).isFile()) continue;
    fs.copyFileSync(src, path.join(to, name));
    copied.push(name);
  }
  return copied;
}

main();
