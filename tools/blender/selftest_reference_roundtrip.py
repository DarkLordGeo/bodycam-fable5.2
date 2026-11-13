"""Self-test helper (never saves): import the collision reference, check its placement, then build a test
"Corridor" collection next to it so selftest.mjs can export that collection alone.

Prints BODYCAM_REF_JSON {...} with the Blender-space location/dimensions of COL_wall_008 and object counts.
Used only by tools/blender/selftest.mjs; expects to run after import_reference.py in the same Blender process.
"""
import json

import bpy

w = bpy.data.objects.get("COL_wall_008")
ref = bpy.data.collections.get("REF_collision_reference")
info = {
    "imported": len(ref.objects) if ref else 0,
    "locked": all(o.hide_select for o in ref.objects) if ref else False,
    "wall008_loc": [round(v, 3) for v in w.matrix_world.translation] if w else None,
    "wall008_dim": [round(v, 3) for v in w.dimensions] if w else None,
}

# A test panel in its own collection, inside the corridor: three.js x 17..19, y 0..3, z 6.5..7.5
corr = bpy.data.collections.new("Corridor")
bpy.context.scene.collection.children.link(corr)
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(18.0, -7.0, 1.5), scale=(2.0, 1.0, 3.0))
panel = bpy.context.active_object
panel.name = "Corridor_TestPanel"
for c in list(panel.users_collection):
    c.objects.unlink(panel)
corr.objects.link(panel)
print("BODYCAM_REF_JSON " + json.dumps(info))
