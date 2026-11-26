"""暫時探查：左手各掌骨/指骨的主軸、兩端與長度（Blender 座標，公尺）。用完即刪。"""
import bpy, sys, json
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])

def pca_axis(vs):
    c = sum(vs, Vector()) / len(vs)
    m = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
    for v in vs:
        d = v - c
        for i in range(3):
            for j in range(3):
                m[i][j] += d[i] * d[j]
    a = Vector((0.3, 0.5, 0.8))
    for _ in range(60):
        a = (m @ a).normalized()
    return c, a

out = {}
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    name = o.get("sourceName") or o.name
    if not name.endswith(".l"):
        continue
    if not any(k in name for k in ("phalanx", "metacarpal", "Capitate", "Lunate", "Scaphoid", "Hamate", "Trapezium")):
        continue
    mw = o.matrix_world
    vs = [mw @ v.co for v in o.data.vertices]
    c, a = pca_axis(vs)
    if a.z > 0:  # 主軸統一指向遠端（下方）
        a = -a
    proj = sorted(vs, key=lambda v: (v - c).dot(a))
    n = max(3, len(vs) // 20)
    prox = sum(proj[:n], Vector()) / n
    dist = sum(proj[-n:], Vector()) / n
    out[name] = {
        "c": [round(x, 4) for x in c], "axis": [round(x, 3) for x in a],
        "prox": [round(x, 4) for x in prox], "dist": [round(x, 4) for x in dist],
        "len": round((dist - prox).length, 4), "nv": len(vs),
    }
print("PROBE_JSON " + json.dumps(out, ensure_ascii=False))
