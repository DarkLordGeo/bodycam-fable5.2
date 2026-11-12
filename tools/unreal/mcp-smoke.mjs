#!/usr/bin/env node
// Read-only smoke test for Epic's Unreal MCP server (UE 5.8 ModelContextProtocol plugin).
// Usage: node tools/unreal/mcp-smoke.mjs [url]   (default http://127.0.0.1:8000/mcp)
// Performs: initialize -> tools/list -> list_toolsets -> SceneTools.get_current_level -> SceneTools.find_actors.
// Nothing here modifies the editor, level or assets.
const url = process.argv[2] || process.env.UNREAL_MCP_URL || 'http://127.0.0.1:8000/mcp';
let session = null;
let id = 0;

async function rpc(method, params, { notify = false } = {}) {
  const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notify ? {} : { id: ++id }) };
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (session) headers['mcp-session-id'] = session;
  headers['mcp-protocol-version'] = '2025-11-25';
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  session = res.headers.get('mcp-session-id') || session;
  if (notify) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${text.slice(0, 300)}`);
  // Streamable HTTP may answer as SSE; take the last data: line carrying our id.
  const json = (res.headers.get('content-type') || '').includes('text/event-stream')
    ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5))).filter((m) => m.id === body.id).pop()
    : JSON.parse(text);
  if (json?.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

const short = (r) => (r?.content || []).map((c) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n').slice(0, 1500);
const step = (name, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail.replace(/\n/g, '\n      ')}` : ''}`);

let failed = 0;
try {
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bodycam-mcp-smoke', version: '1.0' } });
  step('initialize', !!init?.serverInfo, `server=${init?.serverInfo?.name} ${init?.serverInfo?.version ?? ''} protocol=${init?.protocolVersion} session=${session ? 'yes' : 'no'}`);
  await rpc('notifications/initialized', null, { notify: true });

  const tools = await rpc('tools/list', {});
  const names = (tools?.tools || []).map((t) => t.name);
  step('tools/list', names.length > 0, names.join(', '));

  const call = (name, args) => rpc('tools/call', { name, arguments: args });
  const ts = await call('list_toolsets', {});
  step('list_toolsets', !ts?.isError, short(ts));

  const SCENE = 'editor_toolset.toolsets.scene.SceneTools';
  const lvl = await call('call_tool', { toolset_name: SCENE, tool_name: 'get_current_level', arguments: {} }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e) }] }));
  step('SceneTools.get_current_level (read-only)', !lvl?.isError, short(lvl));
  if (lvl?.isError) failed++;

  const act = await call('call_tool', { toolset_name: SCENE, tool_name: 'find_actors', arguments: { name: '', tag: '', collision_channels: [] } }) // UE 5.8 marks params with non-None defaults as required; '' matches all.catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e) }] }));
  step('SceneTools.find_actors (read-only)', !act?.isError, short(act));
  if (act?.isError) failed++;
} catch (e) {
  failed++;
  step('connection', false, `${e.message}\n(Is the editor running? tools/unreal/launch-editor.ps1)`);
}
process.exit(failed ? 1 : 0);
