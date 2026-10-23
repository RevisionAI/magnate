#!/usr/bin/env node
// Publishes the C# engine (Magnate.Engine + Magnate.Bridge) to WebAssembly and
// copies the runtime into web/public/_framework so Vite serves it verbatim.
//
//   node scripts/build-engine.mjs            # Release publish (trimmed)
//   node scripts/build-engine.mjs --debug    # faster Debug build, no trimming
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const hostProject = join(webRoot, 'engine-host', 'Magnate.Wasm.csproj');
const outDir = join(webRoot, 'engine-host', 'bin', 'publish');
const target = join(webRoot, 'public', '_framework');
const debug = process.argv.includes('--debug');

const home = os.homedir();
const env = {
  ...process.env,
  PATH: `${join(home, '.dotnet')}:${process.env.PATH ?? ''}`,
  DOTNET_ROOT: process.env.DOTNET_ROOT ?? join(home, '.dotnet'),
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_NOLOGO: '1',
};

const args = debug
  ? ['build', hostProject, '-c', 'Debug', '-o', outDir]
  : ['publish', hostProject, '-c', 'Release', '-o', outDir];

console.log(`[build-engine] dotnet ${args.join(' ')}`);
const started = Date.now();
rmSync(outDir, { recursive: true, force: true });
const result = spawnSync('dotnet', args, { env, stdio: 'inherit' });
if (result.status !== 0) {
  console.error('[build-engine] dotnet failed');
  process.exit(result.status ?? 1);
}

// Publish lays files out under wwwroot/_framework; a plain build uses wwwroot/_framework too.
const candidates = [join(outDir, 'wwwroot', '_framework'), join(outDir, '_framework')];
const source = candidates.find((c) => existsSync(c));
if (!source) {
  console.error(`[build-engine] could not find _framework under ${outDir}`);
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });

let bytes = 0;
for (const f of readdirSync(target)) bytes += statSync(join(target, f)).size;
console.log(
  `[build-engine] copied ${readdirSync(target).length} files (${(bytes / 1048576).toFixed(1)} MB) to public/_framework in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);
