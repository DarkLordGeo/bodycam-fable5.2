# Development environment setup report

Set up 2026-11-12, re-verified **2026-11-13** by Claude Code (Opus 5.5). Branch `chore/dev-environment-setup-v2`, based on
`main` @ 5fda95a (Phase 1). Re-run every check with `npm run verify:env` (add `-- --require-unreal` to fail when the editor is closed).
Paths are written with `%USERPROFILE%` (your home folder) so no account-specific path is committed.

## Status at a glance

Each row distinguishes **configured**, **running** and **verified** (an actual test passed).

| Capability | Status | Evidence |
| --- | --- | --- |
| GitHub repo accessible | ✅ Verified | `git ls-remote origin main` succeeds. `gh` is logged in as the repo owner |
| Project context (`CLAUDE.md`, docs) | ✅ Present, matches `main` | `verify:env` docs checks. Content checked against Phase 1 code |
| Unreal Editor ↔ MCP (read-only tools) | ✅ Verified | `npm run verify:unreal`: initialize, tools/list, list_toolsets, `get_current_level`, `find_actors`. Live probe read project, level, 145 actors, camera, PIE state |
| Unreal MCP auto-start after editor restart | ✅ Verified | Editor relaunched **without** command-line flags; the server came back from project config |
| Claude Code ↔ Unreal MCP registration | ✅ Configured, connected | `verify:env` reports configured / running / connected separately; Claude's own health check → Connected |
| A model-driven `unreal-mcp` call from a *new* Claude session | ✅ Verified (2026-11-13) | Fresh session in this folder called `mcp__unreal-mcp__*`: 19 toolsets, level `/Temp/Untitled_1`, 145 actors |
| `CLAUDE.md` discovered by a new session | ✅ Verified (2026-11-13) | Fresh session had the BODYCAM context loaded at start |
| GLB import into Unreal | ⚠️ Manual only | Unreal MCP `import_file` accepts FBX/OBJ only (tested). Use the editor's Interchange glTF import |
| Blender headless Python (`bpy`) + GLB export | ✅ Verified | `npm run verify:blender`: 13/13, including Phase 1 room rules and the collision-reference round trip. Real `.blend` exported with source hash and mtime unchanged |
| GLB validator vs three.js | ✅ Verified | `glb-report` bounds equal three.js `Box3` on `collision_reference.glb` |
| Game toolchain | ✅ Verified | `npm ci`, `typecheck`, `build`, `test:e2e` **53/53** (fingerprint `598d34f6`) |

## Machine inventory

| Item | Value |
| --- | --- |
| OS | Windows 11 Home 10.0.26200 (build 26200) |
| GPU | NVIDIA GeForce RTX 3050 (4 GB reported), Intel UHD Graphics 730 |
| Disk | C: about 82 GB free at setup time |
| Git / GitHub CLI | 2.47.1.windows.2 / gh 2.101.0 (logged in) |
| Node.js / npm | v22.19.0 / 11.12.1. Native TypeScript type stripping is used by `glb-report --room`. No pnpm, yarn or bun |
| Python | 3.13 (`%LOCALAPPDATA%\Programs\Python\Python313`, py-launcher default), 3.12.6 (`C:\Python312`, `python` on PATH), uv/uvx 0.12.18 |
| Claude Code | 2.1.236 (`%USERPROFILE%\.local\bin\claude.exe`) |
| Unreal Engine | **5.8.4** (CL 58902052, `++UE5+Release-5.8`) at `%USERPROFILE%\Desktop\UE_5.8`. The only registered engine (HKCU `...\Unreal Engine\Builds`). No Epic Launcher installs. Settings folders for 4.16/4.27/5.3/5.5 exist, but those engines are not installed |
| Unreal projects | None existed before setup. `%USERPROFILE%\Desktop\Projects\BodycamVisDev\BodycamVisDev.uproject` was created (below) |
| Blender | **5.2.2 LTS** (build 2026-09-15), `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`, bundled Python 3.13.13. Not on PATH. A `Blender 4.4` folder exists with no executable |
| Browsers | Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`), Edge |

## Repository

- Clone: `%USERPROFILE%\Desktop\Projects\bodycam-fable5.2`.
- `chore/dev-environment-setup-v2` was rebuilt on `origin/main` (5fda95a). It has no upstream tracking, so a bare `git push` cannot hit `main`.
  The first attempt, `chore/dev-environment-setup` (f885df4, based on pre-Phase-1 `b9e4ea0`), is kept unchanged for reference.
  Local `main` still points at `b9e4ea0` (behind `origin/main` by 1) and was not touched.
- This branch adds `CLAUDE.md`, `docs/DEVELOPMENT_SETUP.md`, `docs/ENVIRONMENT_PHASE_1.md` and `tools/**`. It extends
  `docs/ENVIRONMENT_PIPELINE.md` (sections appended; Phase 1 text unchanged), and adds three `verify:*` scripts to
  `package.json` plus two `.gitignore` entries.
- No gameplay code, `Level.ts`, colliders, navigation, physics or assets were changed.

## Unreal Engine integration (Epic's official Unreal MCP)

**What it is.** UE 5.8 ships Epic's experimental `ModelContextProtocol` plugin ("Unreal MCP"). It embeds a Streamable-HTTP
MCP server in the editor, and its tools come from the Toolset Registry.
Docs: <https://dev.epicgames.com/documentation/unreal-engine/unreal-mcp-in-unreal-editor?application_version=5.8>.
Nothing third-party was downloaded.

**Visual-dev project** (outside the repo): `%USERPROFILE%\Desktop\Projects\BodycamVisDev`
- Blueprint-only, no content. Enabled plugins: `ModelContextProtocol`, `EditorToolset`, plus dependencies `ToolsetRegistry`,
  `PythonScriptPlugin`, `EditorScriptingUtilities`. "All Toolsets" is deliberately **not** enabled. Add individual toolsets when needed.
- `Config/DefaultEditorPerProjectUserSettings.ini` → `[/Script/ModelContextProtocolEngine.ModelContextProtocolSettings]`
  `bAutoStartServer=True`, `ServerPortNumber=8000`, `ServerUrlPath=/mcp`, `bEnableToolSearch=True`.
- `Config/DefaultEngine.ini` → `ModelContextProtocol.EnableAnalytics=0` (verified `false` via MCP). Delete the line to re-enable.
- 19 toolsets exposed: AgentSkillToolset, EditorAppToolset, LogsToolset, plus the Python editor toolsets (Actor, Asset,
  Blueprint, CurveTable, DataAsset, DataTable, Material, MaterialInstance, Object, Primitive, Programmatic, Scene,
  SkeletalMesh, StaticMesh, StringTable, Texture).
- Suggested use for Phase 1 work: import `art/reference/collision_reference.glb` as a reference mesh, block out or light the
  corridor for review. Nothing exported from Unreal ships.
- **GLB import is manual.** Drag the `.glb` into the Content Browser (Interchange glTF importer, enabled by default).
  `StaticMeshTools.import_file` pins the FBX factory and rejects `.glb` ("FbxFactory does not support .glb files. Allowed: ['fbx', 'obj']"),
  tested 2026-11-13. The glTF → Unreal axis/unit mapping is not yet verified (U11).

**Claude Code connection** (machine-specific, not in the repo):
`claude mcp add --transport http --scope local unreal-mcp http://127.0.0.1:8000/mcp`, run in the repo folder.
The entry is stored in `%USERPROFILE%\.claude.json` under this project's path. A backup from before the change:
`%USERPROFILE%\.claude\backups\claude.json.2026-11-12-before-bodycam-setup.bak`.

**Launch:** `powershell -File tools/unreal/launch-editor.ps1`. The engine is resolved from the project's `EngineAssociation`
through the registry. Override with `BODYCAM_UE_ROOT` / `BODYCAM_UE_PROJECT`. `BODYCAM_DRY_RUN=1` prints the resolution only.
Opening the `.uproject` normally also starts the server.

**Using it from Claude** (tool-search mode): `list_toolsets` → `describe_toolset {toolset_name}` →
`call_tool {toolset_name, tool_name, arguments}`. Read-only starters:
- `editor_toolset.toolsets.scene.SceneTools`:
  - `get_current_level` with `{}`
  - `find_actors` with `{"name": "", "tag": "", "collision_channels": []}`
  - `get_folders`
- `EditorToolset.EditorAppToolset`: `GetSelectedActors`, `GetCameraTransform`, `IsPIERunning`, `SearchCVars {"name": "..."}`, `CaptureViewport`
- `EditorToolset.LogsToolset`: the Output Log

**Quirks found:**
- UE 5.8 marks Python tool parameters with non-`None` defaults (e.g. `name: str = ''`) as *required*, and rejects an empty
  arguments object. Pass them explicitly.
- `serverInfo.name` is empty (Epic's docs say "unreal-mcp").
- The editor log shows `Call to unknown method "server/discover"` when Claude Code health-checks the server. This is harmless.

**Security / licensing:** the listener is bound to `127.0.0.1` (verified) and has **no authentication**. Never expose or forward it.
The editor logs that data sent through the plugin to an LLM service is "Licensed Technology" under UE EULA §6(e).

**Instance check:** `verify:env` confirms port 8000 belongs to the editor running `BodycamVisDev.uproject`. An editor
launched from the Epic Launcher without a project runs no MCP server and is never touched.

## Blender automation

Direct headless Python is enough, so **no Blender MCP add-on was installed.** Scripts are in `tools/blender/`:

| Script | Purpose |
| --- | --- |
| `inspect_scene.py` | Read-only report: version, units, collections, materials, objects with triangle counts. `-- --json` for JSON |
| `export_glb.py` | GLB export (`export_yup`, modifiers applied, custom props → `extras`, no cameras/lights). Never saves the `.blend`. Refuses to overwrite without `--overwrite`, and refuses `public/` without `--allow-public-assets` |
| `glb-report.mjs` | Dependency-free validator: GLB 2.0, stats, world bounds, no external URIs, textures ≤ 1K, no Draco/KTX2 (meshopt is allowed). `--room <id>` applies `RoomVisuals.validate()` rules from the real `Rooms.ts` / `RoomManifest.ts` |
| `import_reference.py` | Imports `art/reference/collision_reference.glb` into collection `REF_collision_reference` (unselectable, wireframe, not rendered). Never saves |
| `selftest.mjs` (+ `selftest_build_scene.py`, `selftest_reference_roundtrip.py`) | End-to-end test in a temp dir: export, axis mapping, guards, room-rule pass/fail, reference import placement and collection-only export. Touches no project or `.blend` |

Corridor workflow (bash, from the repo root):

```bash
BLENDER="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
"$BLENDER" path/to/corridor.blend --python tools/blender/import_reference.py      # once, in the GUI session you model in
"$BLENDER" -b path/to/corridor.blend --python tools/blender/inspect_scene.py -- --json
"$BLENDER" -b path/to/corridor.blend --python tools/blender/export_glb.py -- --out /tmp/room_corridor.glb --collection Corridor
node tools/blender/glb-report.mjs /tmp/room_corridor.glb --room corridor   # bounds, Y range, 60k budget, no COL_/REF_/UCX_
# only when shipping is intended:  --out public/assets/models/env/room_corridor.glb --allow-public-assets
# then: npm run build && npm run preview, open http://localhost:4173/?glb=corridor&colliders, and npm run test:e2e
```

Axis mapping, verified: Blender `(1, 2, 3)` → three.js `(1, 3, −2)`. Blender +Y = three.js −Z (player forward at yaw 0).
The collision reference imports into Blender with default glTF settings. Verified: `COL_wall_008` lands at Blender (2, −5.25, 2.1), 3 × 0.5 × 4.2 m.

## Claude Code configuration summary

| What | Where | In Git? |
| --- | --- | --- |
| Project instructions | `CLAUDE.md` (imports `PROJECT_GUIDE.md`) | Yes (once committed) |
| Pipeline / Phase 1 docs | `docs/ENVIRONMENT_PIPELINE.md`, `docs/ENVIRONMENT_PHASE_1.md` | Yes (once committed) |
| `unreal-mcp` server | `%USERPROFILE%\.claude.json`, local scope for this folder | No (machine-specific) |
| `.mcp.json`, `.claude/settings.local.json` | Ignored by `.gitignore` | No |
| Three.js debug MCPs (`parallax-threejs`), Vercel | User-level plugins, already present | No |

No credentials or tokens are stored in any committed file. A scan for token, password and API-key patterns was clean.

## Verification results (2026-11-13, this branch)

- `npm run verify:env -- --require-unreal`, editor running: **33 passed, 0 failed**, `configured=yes running=yes connected=yes`.
- `npm run verify:env`, editor closed: configured checks PASS. The running and connected checks report **SKIP** (not PASS), exit 0.
  With `--require-unreal` they report FAIL, exit 1. With a missing `.uproject` the configured check FAILs.
- Fresh Claude Code session in this folder: `CLAUDE.md` loaded at start. `unreal-mcp` tools are present. `list_toolsets` (19),
  `get_current_level` (`/Temp/Untitled_1`) and `find_actors` (145) all PASS.
- `npm ci`: 35 packages, 0 vulnerabilities.
- `npm run typecheck`, `npm run build`: pass. `build` warns about a 5.2 MB JS chunk (pre-existing).
- `npm run preview` + `CHROME="C:\Program Files\Google\Chrome\Application\chrome.exe" npm run test:e2e`: **53/53 passed**.
  Fingerprint `598d34f6` with 130 statics. End-of-run renderer sample: 629 draw calls, 119k triangles (limit < 900).
  Pre-Phase-1 the same sample was 361 calls.
- The e2e run overwrites `docs/screenshots/e2e-final-frame.png`. It was restored with `git restore`.
- The Unreal editor was restarted without flags: MCP auto-started and the smoke test passed again.
- A real `.blend` from another project was exported to a temp dir. Its SHA-256 and mtime were unchanged, and no `.blend1` was created.
- Unreal MCP `StaticMeshTools.import_file` with a `.glb`: rejected (FBX/OBJ only). Nothing was created in the project.
- Headless `claude -p`: **blocked**. `claude auth status` reports `loggedIn: false` (the desktop app signs in separately). This is not
  needed: the fresh desktop session above covers the same check.

## Remaining manual steps

1. Start Claude Code sessions **in this folder**, with the editor already running. Local MCP servers load only at session start, and
   only for this exact path. A session started elsewhere, or before the editor, has no `unreal-mcp` tools until `/mcp` reconnects.
2. *(Optional, for terminal use)* run `claude` and `/login`. The terminal CLI is signed out.
3. For `test:e2e` / `export:collision` on Windows set `CHROME` as above. After e2e, `git restore docs/screenshots/e2e-final-frame.png`
   unless you want the new frame.
4. **Decide the modeling blockers B1–B4** in `docs/ENVIRONMENT_PHASE_1.md` §10: art acceptance criteria, material/texture approach,
   fixture flicker and source-file location. B1 needs the original assessment, which was not found locally or in Google Drive,
   or a fresh decision.
5. Import a GLB into Unreal by hand once, and record the axis/unit mapping (U11) if Unreal is used for review.
6. Review the branch and approve a push or merge. Optionally run `git pull` (fast-forward) on local `main` to match `origin/main`.

## Troubleshooting

- **Unreal MCP not reachable:**
  - Is the BodycamVisDev editor open?
  - Check `Saved/Logs/BodycamVisDev.log` for `LogHttpListener: Created new HttpListener on 127.0.0.1:8000`.
  - If the port is busy, check `Get-NetTCPConnection -LocalPort 8000`. Or launch with `-Port 8001` and re-add the server with that URL.
- **Claude says the server is not connected:** start the editor before Claude, or reconnect with `/mcp`. Check `claude mcp get unreal-mcp`.
- **"input param X is required":** pass every parameter that has a non-`None` default.
- **More logging:** in the editor console run `Log LogModelContextProtocol Verbose`. `ModelContextProtocol.RefreshTools` re-polls toolsets.
- **Do not overlap tool calls:** they run serially on the game thread.
- **Blender not found:** set `BLENDER_EXE`.
- **`glb-report --room` import error:** it needs Node ≥ 22.18 (type stripping) and runs from inside the repo.
- **Undo:**
  1. `claude mcp remove unreal-mcp -s local`.
  2. Delete `%USERPROFILE%\Desktop\Projects\BodycamVisDev`.
  3. Delete the setup branches.

## Pre-existing issues noticed (not changed)

- The `package.json` script `screenshot` points to `scripts/screenshot.mjs`, which does not exist (the script is `scripts/shot.mjs`).
- `scripts/e2e.mjs` and `scripts/export-collision-reference.mjs` default to a Linux Chrome path.
- Phase 1 roughly doubled end-of-run draw calls in the e2e sample (361 → 629). This is still inside the < 900 check, but worth watching once the corridor GLB adds its own meshes.
