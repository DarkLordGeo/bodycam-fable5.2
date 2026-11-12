"""Export the open .blend (or one collection / the selection) to GLB. Never saves the .blend.

Run (headless):
  blender -b path/to/source.blend --python tools/blender/export_glb.py -- --out path/to/file.glb
      [--collection NAME] [--selected] [--overwrite] [--allow-public-assets]

Safety rails:
  * The .blend is opened read-only in practice: this script never calls save.
  * Refuses to overwrite an existing output unless --overwrite.
  * Refuses to write under the repo's public/ (shipping assets) unless --allow-public-assets.

Axis convention (Blender glTF exporter, export_yup=True): Blender (x, y, z) -> glTF/three.js (x, z, -y).
So Blender +Y becomes three.js -Z, the direction the player faces at yaw 0. Units: 1 Blender unit = 1 m.
"""
import os
import sys

import bpy


def parse() -> dict:
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"out": None, "collection": None, "selected": False, "overwrite": False, "allow_public": False}
    i = 0
    while i < len(a):
        k = a[i]
        if k == "--out":
            opts["out"] = a[i + 1]; i += 1
        elif k == "--collection":
            opts["collection"] = a[i + 1]; i += 1
        elif k == "--selected":
            opts["selected"] = True
        elif k == "--overwrite":
            opts["overwrite"] = True
        elif k == "--allow-public-assets":
            opts["allow_public"] = True
        else:
            raise SystemExit(f"unknown argument: {k}")
        i += 1
    if not opts["out"]:
        raise SystemExit("--out path.glb is required")
    return opts


def main() -> None:
    o = parse()
    out = os.path.abspath(o["out"])
    if not out.lower().endswith(".glb"):
        raise SystemExit("output must end in .glb")
    norm = out.replace("\\", "/").lower()
    if "/public/" in norm and not o["allow_public"]:
        raise SystemExit(f"refusing to write into public/ (shipping assets) without --allow-public-assets: {out}")
    if os.path.exists(out) and not o["overwrite"]:
        raise SystemExit(f"output exists, pass --overwrite to replace: {out}")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    kwargs = dict(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_apply=True,  # apply modifiers
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_extras=True,  # custom properties -> glTF extras (used for metadata, not physics)
    )
    if o["collection"]:
        coll = bpy.data.collections.get(o["collection"])
        if coll is None:
            raise SystemExit(f"collection not found: {o['collection']}")
        kwargs["use_active_collection"] = True
        layer = bpy.context.view_layer.layer_collection
        stack = [layer]
        while stack:
            lc = stack.pop()
            if lc.collection == coll:
                bpy.context.view_layer.active_layer_collection = lc
                break
            stack.extend(lc.children)
    if o["selected"]:
        kwargs["use_selection"] = True

    result = bpy.ops.export_scene.gltf(**kwargs)
    print(f"BODYCAM_EXPORT {result} -> {out} ({os.path.getsize(out)} bytes)")


main()
