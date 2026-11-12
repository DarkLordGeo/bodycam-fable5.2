"""Self-test helper: builds a throwaway in-memory scene (never saved) for the export round-trip tests.

Default (BC_SCENE unset): a 1 m cube BC_TestCube on the floor at the origin, plus an empty BC_AxisMarker at
Blender (1, 2, 3). Expected glTF/three.js position of the marker: (1, 3, -2).

BC_SCENE=corridor: a 2 x 1 x 3 m box "Corridor_TestPanel" placed inside the corridor room rect
(three.js x 17..19, y 0..3, z 6.5..7.5 -> Blender y -6.5..-7.5). With BC_HELPER=1 an extra "COL_test_001"
box is added, which room validation must reject.
Used only by tools/blender/selftest.mjs.
"""
import os

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
if os.environ.get("BC_SCENE") == "corridor":
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(18.0, -7.0, 1.5), scale=(2.0, 1.0, 3.0))
    bpy.context.active_object.name = "Corridor_TestPanel"
    if os.environ.get("BC_HELPER") == "1":
        bpy.ops.mesh.primitive_cube_add(size=0.5, location=(10.0, -7.0, 0.25))
        bpy.context.active_object.name = "COL_test_001"
else:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.5))
    bpy.context.active_object.name = "BC_TestCube"
    marker = bpy.data.objects.new("BC_AxisMarker", None)
    marker.location = (1.0, 2.0, 3.0)
    bpy.context.scene.collection.objects.link(marker)
print("BODYCAM_SELFTEST_SCENE_READY")
