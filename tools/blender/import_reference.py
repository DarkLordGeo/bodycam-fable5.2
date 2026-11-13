"""Import art/reference/collision_reference.glb into the open .blend as a locked modelling guide. Never saves.

Run inside Blender (Scripting tab -> Open -> Run Script) or headless:
  blender -b [your_corridor.blend] --python tools/blender/import_reference.py -- [--file path/to/collision_reference.glb]

Result:
  * collection "REF_collision_reference" (unselectable, wireframe display, excluded from render)
  * all objects keep their glTF names: COL_* (real colliders), REF_door_opening_* (keep clear), ROOM_* (room rects)
  * nothing else in the file is touched; save the .blend yourself if you want to keep the reference in it

The default glTF importer converts three.js Y-up to Blender Z-up: three (x, y, z) -> Blender (x, -z, y).
Model the room in its own collection (e.g. "Corridor") and export only that collection with export_glb.py --collection.
"""
import os
import sys

import bpy

COLL = "REF_collision_reference"


def parse() -> str:
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--file" in a:
        return os.path.abspath(a[a.index("--file") + 1])
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, "..", "..", "art", "reference", "collision_reference.glb"))


def main() -> None:
    path = parse()
    if not os.path.isfile(path):
        raise SystemExit(f"collision reference not found: {path} (run npm run export:collision)")
    if bpy.data.collections.get(COLL):
        raise SystemExit(f'collection "{COLL}" already exists; delete it first to re-import')

    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)  # default settings: Y-up -> Z-up conversion
    new = [o for o in bpy.data.objects if o not in before]

    coll = bpy.data.collections.new(COLL)
    bpy.context.scene.collection.children.link(coll)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
        o.hide_select = True
        o.hide_render = True
        o.display_type = "WIRE"
        o["bodycam_reference"] = True
    coll.hide_render = True
    print(f"BODYCAM_REFERENCE_IMPORTED {len(new)} objects into '{COLL}' from {path}")


main()
