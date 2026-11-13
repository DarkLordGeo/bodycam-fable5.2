#!/usr/bin/env node
// One-command dev-environment check for BODYCAM. Read-only apart from a temp GLB in the OS temp dir.
// Usage: npm run verify:env        (or: node tools/verify-env.mjs [--require-unreal])
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

// 3-4. Unreal MCP <-> Claude Code, reported in three stages:
//   CONFIGURED  project plugins + auto-start config exist, and Claude Code has the local-scope registration
//   RUNNING     an Unreal Editor with the BodycamVisDev project owns the loopback listener on the MCP port
//   CONNECTED   real MCP calls succeed (smoke test) AND Claude Code's own health check reports Connected
// When the editor is not running, RUNNING/CONNECTED are SKIP (never PASS). --require-unreal turns that into FAIL.
const requireUnreal = process.argv.includes('--require-unreal');
const MCP_URL = 'http://127.0.0.1:8000/mcp';
const ueProject = process.env.BODYCAM_UE_PROJECT || join(root, '..', 'BodycamVisDev', 'BodycamVisDev.uproject');
const stage = { configured: true, running: null, connected: null };

// CONFIGURED: Unreal project side
if (!existsSync(ueProject)) { stage.configured = false; check('unreal', 'configured: visual-dev project exists', 'FAIL', ueProject); }
else {
  const up = JSON.parse(readFileSync(ueProject, 'utf8'));
  const on = (n) => (up.Plugins || []).some((p) => p.Name === n && p.Enabled);
  const plug = ['ModelContextProtocol', 'EditorToolset'].every(on);
  if (!plug) stage.configured = false;
  check('unreal', 'configured: ModelContextProtocol + EditorToolset enabled in .uproject', plug ? 'PASS' : 'FAIL');
  const ini = join(dirname(ueProject), 'Config', 'DefaultEditorPerProjectUserSettings.ini');
  const auto = existsSync(ini) && /bAutoStartServer\s*=\s*True/i.test(readFileSync(ini, 'utf8'));
  if (!auto) stage.configured = false;
  check('unreal', 'configured: MCP auto-start enabled in project config', auto ? 'PASS' : 'FAIL', auto ? '' : ini);
}
// CONFIGURED: Claude Code side (claude mcp get reads the persisted config; its Status line is a live health check)
const mcp = sh('claude', ['mcp', 'get', 'unreal-mcp']);
const mcpOut = (mcp.stdout || '') + (mcp.stderr || '');
const registered = !mcp.error && /Scope:/i.test(mcpOut) && mcpOut.includes(MCP_URL);
if (!registered) stage.configured = false;
check('claude', 'configured: unreal-mcp registered (local scope, ' + MCP_URL + ')', registered ? 'PASS' : 'FAIL',
  registered ? (mcpOut.match(/Scope: .*/) || [''])[0].trim() : 'run: claude mcp add --transport http --scope local unreal-mcp ' + MCP_URL);
const claudeHealth = /Status:.*Connected/i.test(mcpOut) && !/Failed/i.test((mcpOut.match(/Status: .*/) || [''])[0]) ? 'connected' : /Status:/i.test(mcpOut) ? 'failed' : 'unknown';

// RUNNING: who owns the port?
let owner = { addr: '', cmdline: '' };
if (process.platform === 'win32') {
  const script = "$c=Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue | Select -First 1; if($c){ \"$($c.LocalAddress)|\" + (Get-CimInstance Win32_Process -Filter \"ProcessId=$($c.OwningProcess)\").CommandLine }";
  const ps = sh('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { shell: false });
  const [addr = '', cmdline = ''] = ps.stdout.trim().split('|'); owner = { addr, cmdline };
}
const notRunning = requireUnreal ? 'FAIL' : 'SKIP';
const startHint = 'start it: powershell -File tools/unreal/launch-editor.ps1';
if (!owner.addr) {
  stage.running = false;
  check('unreal', 'running: editor serving MCP on 127.0.0.1:8000', notRunning, 'nothing is listening on port 8000; ' + startHint);
} else {
  const proj = (owner.cmdline.match(/[^"\s]+\.uproject/i) || ['<no project>'])[0];
  const isOurs = /BodycamVisDev\.uproject/i.test(owner.cmdline);
  const loop = owner.addr === '127.0.0.1' || owner.addr === '::1';
  stage.running = isOurs && loop;
  check('unreal', 'running: port 8000 owned by editor with BodycamVisDev project', isOurs ? 'PASS' : 'FAIL', owner.addr + ' ' + proj);
  check('unreal', 'running: MCP listener is loopback only', loop ? 'PASS' : 'FAIL', owner.addr);
}

// CONNECTED: real read-only MCP calls + Claude Code's health check
if (!stage.running) {
  stage.connected = false;
  check('unreal', 'connected: read-only MCP calls (initialize .. find_actors)', notRunning, 'editor not running');
  check('claude', 'connected: Claude Code health check reaches unreal-mcp', notRunning, 'editor not running (claude reports: ' + claudeHealth + ')');
} else {
  const smoke = sh(process.execPath, [join(root, 'tools/unreal/mcp-smoke.mjs')]);
  const lines = smoke.stdout.split('\n').filter((l) => /^(PASS|FAIL) /.test(l));
  for (const l of lines) check('unreal', 'connected: ' + l.slice(6).trim(), l.slice(0, 4));
  const smokeOk = smoke.status === 0 && lines.length >= 5;
  if (!lines.length) check('unreal', 'connected: read-only MCP calls', 'FAIL', (smoke.stdout + smoke.stderr).slice(0, 200));
  check('claude', 'connected: Claude Code health check reaches unreal-mcp', claudeHealth === 'connected' ? 'PASS' : 'FAIL', 'claude mcp get: ' + claudeHealth);
  stage.connected = smokeOk && claudeHealth === 'connected';
}
const fmt = (v) => (v === true ? 'yes' : v === false ? 'no' : '-');
const stageLine = 'Unreal MCP: configured=' + fmt(stage.configured) + '  running=' + fmt(stage.running) + '  connected=' + fmt(stage.connected);

// 5. Blender automation
const bl = sh(process.execPath, [join(root, 'tools/blender/selftest.mjs')]);
for (const line of bl.stdout.split('\n').filter((l) => /^(PASS|FAIL) /.test(l))) check('blender', line.slice(6).trim(), line.slice(0, 4));

// 6. Node toolchain for the game
check('node', 'node_modules installed', existsSync(join(root, 'node_modules')) ? 'PASS' : 'SKIP', existsSync(join(root, 'node_modules')) ? '' : 'run npm install (then npm run typecheck / build / test:e2e)');

const fails = results.filter((r) => r.status === 'FAIL').length, skips = results.filter((r) => r.status === 'SKIP').length;
console.log(`\n${stageLine}`);
console.log(`${results.length - fails - skips} passed, ${fails} failed, ${skips} skipped${skips && !requireUnreal ? ' (use --require-unreal to treat a closed editor as a failure)' : ''}`);
process.exit(fails ? 1 : 0);
