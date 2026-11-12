#!/usr/bin/env node
// One-command dev-environment check for BODYCAM. Read-only apart from a temp GLB in the OS temp dir.
// Usage: npm run verify:env        (or: node tools/verify-env.mjs)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 240000, shell: process.platform === 'win32' && !cmd.includes('\\'), ...opts });
const results = [];
const check = (area, name, status, detail = '') => { results.push({ area, name, status }); console.log(`${status.padEnd(4)}  [${area}] ${name}${detail ? `  ${detail}` : ''}`); };

// 1. Repository
const remote = sh('git', ['remote', 'get-url', 'origin']).stdout.trim();
check('repo', 'origin is DarkLordGeo/bodycam-fable5.2', /DarkLordGeo\/bodycam-fable5\.2/.test(remote) ? 'PASS' : 'FAIL', remote);
const ls = sh('git', ['ls-remote', '--heads', 'origin', 'main']);
check('repo', 'GitHub reachable (git ls-remote)', ls.status === 0 && ls.stdout.includes('refs/heads/main') ? 'PASS' : 'FAIL', ls.stdout.split('\t')[0].slice(0, 12));

// 2. Project context files
for (const f of ['CLAUDE.md', 'PROJECT_GUIDE.md', 'docs/ENVIRONMENT_PIPELINE.md', 'docs/ENVIRONMENT_PHASE_1.md', 'docs/DEVELOPMENT_SETUP.md', 'docs/ARCHITECTURE.md']) {
  const p = join(root, f);
  const ok = existsSync(p) && readFileSync(p, 'utf8').length > 200;
  check('docs', `${f} exists and is readable`, ok ? 'PASS' : 'FAIL');
}

// 3. Claude Code MCP registration (local scope, outside the repo)
const mcp = sh('claude', ['mcp', 'get', 'unreal-mcp']);
const mcpOut = (mcp.stdout || '') + (mcp.stderr || '');
if (mcp.error || /not found/i.test(mcpOut)) check('claude', 'unreal-mcp registered', 'FAIL', 'run: claude mcp add --transport http --scope local unreal-mcp http://127.0.0.1:8000/mcp');
else check('claude', 'unreal-mcp registered (local scope)', 'PASS', (mcpOut.match(/Status: .*/) || [''])[0].trim());

// 4. Unreal Editor + MCP
const smoke = sh(process.execPath, [join(root, 'tools/unreal/mcp-smoke.mjs')]);
if (/connection/.test(smoke.stdout) && smoke.status !== 0) check('unreal', 'Unreal MCP reachable', 'SKIP', 'editor not running? powershell -File tools/unreal/launch-editor.ps1');
else {
  for (const line of smoke.stdout.split('\n').filter((l) => /^(PASS|FAIL) /.test(l))) check('unreal', line.slice(6).trim(), line.slice(0, 4));
  if (process.platform === 'win32') {
    const script = "$c=Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select -First 1; if($c){ \"$($c.LocalAddress)|\" + (Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\").CommandLine }";
    const ps = sh('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { shell: false });
    const [addr, cmdline = ''] = ps.stdout.trim().split('|');
    const proj = (cmdline.match(/[^"\s]+\.uproject/i) || ['<none>'])[0];
    check('unreal', 'port 8000 owned by editor with BodycamVisDev project', /BodycamVisDev\.uproject/i.test(cmdline) ? 'PASS' : 'FAIL', `${addr} ${proj}`);
    check('unreal', 'MCP listener is loopback only', addr === '127.0.0.1' || addr === '::1' ? 'PASS' : 'FAIL', addr);
  }
}

// 5. Blender automation
const bl = sh(process.execPath, [join(root, 'tools/blender/selftest.mjs')]);
for (const line of bl.stdout.split('\n').filter((l) => /^(PASS|FAIL) /.test(l))) check('blender', line.slice(6).trim(), line.slice(0, 4));

// 6. Node toolchain for the game
check('node', 'node_modules installed', existsSync(join(root, 'node_modules')) ? 'PASS' : 'SKIP', existsSync(join(root, 'node_modules')) ? '' : 'run npm install (then npm run typecheck / build / test:e2e)');

const fails = results.filter((r) => r.status === 'FAIL').length, skips = results.filter((r) => r.status === 'SKIP').length;
console.log(`\n${results.length - fails - skips} passed, ${fails} failed, ${skips} skipped`);
process.exit(fails ? 1 : 0);
