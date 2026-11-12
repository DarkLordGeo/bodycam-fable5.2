"""Read-only scene report. Never saves or modifies the .blend.

Run (headless):
  blender -b [file.blend] --factory-startup --python tools/blender/inspect_scene.py -- [--json]
Without a .blend, Blender's factory startup scene is inspected.
"""
import json
import sys

import bpy


def args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def tri_count(obj) -> int:
    if obj.type != "MESH":
        return 0
    deps = bpy.context.evaluated_depsgraph_get()
    mesh = obj.evaluated_get(deps).to_mesh()
    try:
        mesh.calc_loop_triangles()
        return len(mesh.loop_triangles)
    finally:
        obj.evaluated_get(deps).to_mesh_clear()


def main() -> None:
    scene = bpy.context.scene
    report = {
        "blender_version": bpy.app.version_string,
        "python_version": sys.version.split()[0],
        "file": bpy.data.filepath or "<factory startup / unsaved>",
        "scene": scene.name,
        "unit_system": scene.unit_settings.system,
        "unit_scale": scene.unit_settings.scale_length,
        "collections": [c.name for c in bpy.data.collections],
        "materials": [m.name for m in bpy.data.materials],
        "objects": [
            {
                "name": o.name,
                "type": o.type,
                "location": [round(v, 4) for v in o.location],
                "dimensions": [round(v, 4) for v in o.dimensions],
                "triangles": tri_count(o),
                "collections": [c.name for c in o.users_collection],
            }
            for o in scene.objects
        ],
    }
    if "--json" in args():
        print("BODYCAM_JSON_BEGIN")
        print(json.dumps(report, indent=2))
        print("BODYCAM_JSON_END")
    else:
        print(f"Blender {report['blender_version']} (Python {report['python_version']})")
        print(f"File: {report['file']}  Scene: {report['scene']}  Units: {report['unit_system']} x{report['unit_scale']}")
        for o in report["objects"]:
            print(f"  {o['type']:<8} {o['name']:<24} loc={o['location']} dim={o['dimensions']} tris={o['triangles']}")


main()
