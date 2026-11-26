"""
build_arm_zanatomy.py — 以 Z-Anatomy（經 anatomy-explorer 轉檔）真實幾何建立左上肢動態 Rig

輸入：assets/working/zanatomy_arm_l.glb（由 tools/model_optimizer/extract-parts.mjs 產生）
輸出：
  apps/web/public/models/arm_zanatomy_l.glb   動態 Rig（骨架 + skin weights + shape keys）
  apps/web/public/data/arm_manifest.json      由幾何自動推算的關節中心、旋轉軸、肌肉附著點
  assets/working/arm_zanatomy_l.blend

用法：
  blender -b --factory-startup --python build_arm_zanatomy.py -- <in.glb> <out.glb> <manifest.json> [<out.blend>]

授權：幾何為 Z-Anatomy（CC BY-SA 4.0，衍生自 BodyParts3D CC BY-SA 2.1 JP）的衍生物，
輸出同樣以 CC BY-SA 4.0 釋出。附著點為由網格端點推算的近似值（confidence=approximate）。
"""
import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
IN_GLB, OUT_GLB, OUT_MANIFEST = (os.path.abspath(a) for a in argv[:3])
OUT_BLEND = os.path.abspath(argv[3]) if len(argv) > 3 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=IN_GLB)


# ------------------------------------------------------------------ helpers
def obj_by_source(name):
    for o in bpy.data.objects:
        if o.type == "MESH" and (o.name == name or o.get("sourceName") == name or o.name.startswith(name)):
            return o
    raise RuntimeError(f"找不到 {name}")


def apply_transforms(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def verts(o):
    return [v.co.copy() for v in o.data.vertices]


def centroid(pts):
    s = Vector((0, 0, 0))
    for p in pts:
        s += p
    return s / max(1, len(pts))


def end_centroid(o, axis, which, frac):
    """沿 axis 取最上(proximal)或最下(distal) frac 比例頂點的質心"""
    vs = verts(o)
    proj = sorted(vs, key=lambda v: v.dot(axis))
    n = max(3, int(len(proj) * frac))
    return centroid(proj[-n:] if which == "max" else proj[:n])


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0))) if e1 != e0 else (1.0 if x >= e1 else 0.0)
    return t * t * (3 - 2 * t)


def bl_to_gl(v):
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


# ------------------------------------------------------------------ gather meshes
for o in list(bpy.data.objects):
    if o.type == "MESH":
        apply_transforms(o)
    elif o.type == "EMPTY":
        bpy.data.objects.remove(o)

humerus = obj_by_source("Humerus.l")
radius = obj_by_source("Radius.l")
ulna = obj_by_source("Ulna.l")
biceps_parts = [obj_by_source("Long head of biceps brachii.l"), obj_by_source("Short head of biceps brachii.l")]
triceps_parts = [obj_by_source(n) for n in ("Long head of triceps brachii.l", "Lateral head of triceps brachii.l", "Medial head of triceps brachii.l")]
brachialis = obj_by_source("Brachialis muscle.l")

humerus.name = humerus.data.name = "humerus_left"
radius.name = radius.data.name = "radius_left"
ulna.name = ulna.data.name = "ulna_left"
brachialis.name = brachialis.data.name = "brachialis_left"
biceps = join(biceps_parts, "biceps_brachii_left")
triceps = join(triceps_parts, "triceps_brachii_left")

# ------------------------------------------------------------------ landmarks (Blender space: Z-up, anterior = -Y)
UP = Vector((0, 0, 1))
ANTERIOR = Vector((0, -1, 0))

# 先粗估肱骨長軸（上下端質心），再沿此軸精修
h_top = end_centroid(humerus, UP, "max", 0.08)
h_bot = end_centroid(humerus, UP, "min", 0.06)
hum_axis = (h_top - h_bot).normalized()  # 指向近端
shoulder_c = end_centroid(humerus, hum_axis, "max", 0.07)  # 肱骨頭
elbow_c = end_centroid(humerus, hum_axis, "min", 0.05)  # 肱骨滑車/小頭

r_top = end_centroid(radius, UP, "max", 0.08)
r_bot = end_centroid(radius, UP, "min", 0.08)
fore_axis_prox = (r_top - r_bot).normalized()
wrist_c = end_centroid(radius, fore_axis_prox, "min", 0.06)
fore_dir = (wrist_c - elbow_c).normalized()  # 指向遠端
upper_dir = (elbow_c - shoulder_c).normalized()
hand_end = wrist_c + fore_dir * 0.08
clav_c = shoulder_c + Vector((-0.04, 0, 0.02))  # 肩帶虛擬骨根部（朝內上方）

print("LANDMARK shoulder", shoulder_c, "elbow", elbow_c, "wrist", wrist_c)

# ------------------------------------------------------------------ armature
arm_data = bpy.data.armatures.new("ArmRig")
arm_obj = bpy.data.objects.new("ArmRig", arm_data)
scene.collection.objects.link(arm_obj)
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
BONES = [
    ("shoulder_l", clav_c, shoulder_c, None),
    ("upper_arm_l", shoulder_c, elbow_c, "shoulder_l"),
    ("forearm_l", elbow_c, wrist_c, "upper_arm_l"),
    ("hand_l", wrist_c, hand_end, "forearm_l"),
]
for name, head, tail, parent in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head, eb.tail = head, tail
    eb.align_roll(ANTERIOR)
    if parent:
        eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = True
bpy.ops.object.mode_set(mode="OBJECT")


# ------------------------------------------------------------------ skinning
def bind(o, weight_fn):
    o.parent = arm_obj
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    groups = {b[0]: o.vertex_groups.new(name=b[0]) for b in BONES}
    for v in o.data.vertices:
        w = weight_fn(v.co)
        total = sum(w.values()) or 1.0
        for bone, val in w.items():
            if val > 1e-4:
                groups[bone].add([v.index], val / total, "REPLACE")


def along_upper(p):
    """0 = 肩關節中心, 1 = 肘關節中心（沿上臂軸）"""
    L = (elbow_c - shoulder_c).length
    return (p - shoulder_c).dot(upper_dir) / L


def muscle_weights(elbow_lo, elbow_hi):
    L = (elbow_c - shoulder_c).length

    def f(p):
        s = along_upper(p)
        w_fore = smoothstep(1.0 + elbow_lo / L, 1.0 + elbow_hi / L, s)
        w_sh = 1.0 - smoothstep(-0.06, 0.04, s)  # 越過肩關節近端 → 肩帶
        w_up = max(0.0, 1.0 - w_fore - w_sh)
        return {"shoulder_l": w_sh * (1 - w_fore), "upper_arm_l": w_up, "forearm_l": w_fore}
    return f


bind(humerus, lambda p: {"upper_arm_l": 1.0})
bind(radius, lambda p: {"forearm_l": 1.0})
bind(ulna, lambda p: {"forearm_l": 1.0})
bind(biceps, muscle_weights(-0.035, 0.012))
bind(brachialis, muscle_weights(-0.03, 0.008))
bind(triceps, muscle_weights(-0.015, 0.004))


# ------------------------------------------------------------------ shape keys（程序化 contract / stretch）
def bump(t, a=0.08, b=0.85, p=1.2):
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a)) ** p


def add_shape_keys(o, gain_contract, gain_stretch, shorten=0.04):
    vs = verts(o)
    axis = upper_dir
    proj = [v.dot(axis) for v in vs]
    lo, hi = min(proj), max(proj)
    nb = 24
    bins = [[] for _ in range(nb)]
    for v, p in zip(vs, proj):
        bins[min(nb - 1, int((p - lo) / (hi - lo + 1e-9) * nb))].append(v)
    cents = [centroid(b) if b else None for b in bins]
    # 補空 bin
    for i in range(nb):
        if cents[i] is None:
            j = next((k for k in range(1, nb) if (i - k >= 0 and cents[i - k]) or (i + k < nb and cents[i + k])), 0)
            cents[i] = cents[i - j] if i - j >= 0 and cents[i - j] else cents[min(nb - 1, i + j)]
    mid = (lo + hi) / 2

    def center_at(p):
        x = (p - lo) / (hi - lo + 1e-9) * nb - 0.5
        i0 = max(0, min(nb - 1, int(math.floor(x))))
        i1 = min(nb - 1, i0 + 1)
        k = max(0.0, min(1.0, x - i0))
        return cents[i0].lerp(cents[i1], k)

    o.shape_key_add(name="Basis", from_mix=False)
    kc = o.shape_key_add(name="contract", from_mix=False)
    ks = o.shape_key_add(name="stretch", from_mix=False)
    for i, (v, p) in enumerate(zip(vs, proj)):
        t = (p - lo) / (hi - lo + 1e-9)
        c = center_at(p)
        radial = v - c
        radial -= axis * radial.dot(axis)
        b = bump(t)
        # 收縮：肌腹變粗並朝中段聚攏
        toward_mid = axis * ((mid - p) * shorten * b)
        kc.data[i].co = v + radial * (gain_contract * b) + toward_mid
        ks.data[i].co = v - radial * (gain_stretch * b)


add_shape_keys(biceps, 0.45, 0.18)
add_shape_keys(brachialis, 0.30, 0.15)
add_shape_keys(triceps, 0.30, 0.15)


# ------------------------------------------------------------------ materials & metadata
def material(name, rgba, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = rough
    return m


MATS = {
    "bone": material("mat_bone", (0.9, 0.86, 0.76, 1), 0.55),
    "muscle": material("mat_muscle", (0.68, 0.15, 0.13, 1), 0.45),
}
for o, cat in ((humerus, "bone"), (radius, "bone"), (ulna, "bone"), (biceps, "muscle"), (triceps, "muscle"), (brachialis, "muscle")):
    o.data.materials.clear()
    o.data.materials.append(MATS[cat])
    for p in o.data.polygons:
        p.use_smooth = True
    o["anatomicalId"] = o.name
    o["category"] = cat
    for k in ("sourceLayer", "sourceName"):
        if k in o.keys():
            del o[k]


# ------------------------------------------------------------------ manifest（gl 座標）
def near_level(o, s_target, half=0.012, side=None):
    """取上臂軸上指定位置（s，單位 m，自肩）附近的頂點質心；side=anterior/posterior 時只取該側"""
    pts = []
    for v in verts(o):
        s = (v - shoulder_c).dot(upper_dir)
        if abs(s - s_target) <= half:
            pts.append(v)
    if side:
        c = centroid(pts)
        sign = 1 if side == "anterior" else -1
        pts = [p for p in pts if (p - c).dot(ANTERIOR) * sign > 0] or pts
    return centroid(pts)


L_up = (elbow_c - shoulder_c).length


def attach(bone, p, conf="approximate"):
    return {"bone": bone, "position": bl_to_gl(p), "confidence": conf}


def axis_gl(v):
    v = Vector(bl_to_gl(v)).normalized()
    return [round(v.x, 5), round(v.y, 5), round(v.z, 5)]


# 旋轉軸：a = d × f（d = 骨段方向, f = 目標方向）
flex_elbow = fore_dir.cross(ANTERIOR).normalized()
flex_sh = upper_dir.cross(ANTERIOR).normalized()
abd_sh = upper_dir.cross(Vector((1, 0, 0))).normalized()
rot_sh = (-upper_dir).normalized()

SRC = {
    "dataset": "Z-Anatomy (via anatomy-explorer export)",
    "license": "CC-BY-SA-4.0",
    "attribution": "Z-Anatomy – The libre 3D atlas of anatomy (CC BY-SA 4.0), derived from BodyParts3D © The Database Center for Life Science (CC BY-SA 2.1 JP). Rigging, shape keys and attachment estimates by DHA.",
    "url": "https://github.com/Z-Anatomy/Models-of-human-anatomy",
    "derivedFrom": "anatomy-explorer public/models/{skeleton,muscles}.glb",
}

manifest = {
    "version": "0.2.0",
    "note": "Generated by tools/blender/build_arm_zanatomy.py. Geometry: Z-Anatomy. Joint centers/axes and attachments are estimated from mesh extremities (approximate); range-of-motion values are approximate textbook ranges, not measured data.",
    "coordinateSystem": {"up": "Y", "forward": "+Z", "unit": "meter", "handedness": "right"},
    "joints": [
        {
            "id": "shoulder_left", "bone": "upper_arm_l", "side": "left", "center": bl_to_gl(shoulder_c), "restDeg": [0, 0, 0],
            "limits": [
                {"axis": "x", "minDeg": -50, "maxDeg": 170, "confidence": "approximate", "vector": axis_gl(flex_sh), "label": "屈曲/伸展"},
                {"axis": "z", "minDeg": -20, "maxDeg": 170, "confidence": "approximate", "vector": axis_gl(abd_sh), "label": "外展/內收"},
                {"axis": "y", "minDeg": -70, "maxDeg": 90, "confidence": "approximate", "vector": axis_gl(rot_sh), "label": "內旋/外旋"},
            ],
        },
        {
            "id": "elbow_left", "bone": "forearm_l", "side": "left", "center": bl_to_gl(elbow_c), "restDeg": [0],
            "limits": [
                {"axis": "x", "minDeg": 0, "maxDeg": 145, "confidence": "approximate", "vector": axis_gl(flex_elbow), "label": "屈曲/伸展"},
            ],
        },
    ],
    "muscles": [
        {
            "id": "biceps_brachii_left", "name": "Biceps Brachii", "name_zh": "左側肱二頭肌", "name_latin": "Musculus biceps brachii",
            "side": "left", "region": "upper_arm", "architecture": "fusiform", "mesh": "biceps_brachii_left",
            "origin": [attach("shoulder_l", end_centroid(biceps, upper_dir, "min", 0.03))],
            "insertion": [attach("forearm_l", end_centroid(biceps, upper_dir, "max", 0.03))],
            "via_points": [attach("upper_arm_l", near_level(biceps, L_up - 0.03, side="anterior"))],
            "joints_crossed": ["shoulder_left", "elbow_left"],
            "function": ["肘關節屈曲", "前臂旋後", "輔助肩關節屈曲"],
            "innervation": "Musculocutaneous nerve (C5–C6)",
            "activation": 0, "deformation_profile": "fusiform_v1",
            "morphs": {"contract": "contract", "stretch": "stretch"}, "source": SRC,
        },
        {
            "id": "brachialis_left", "name": "Brachialis", "name_zh": "左側肱肌", "name_latin": "Musculus brachialis",
            "side": "left", "region": "upper_arm", "architecture": "fusiform", "mesh": "brachialis_left",
            "origin": [attach("upper_arm_l", end_centroid(brachialis, upper_dir, "min", 0.04))],
            "insertion": [attach("forearm_l", end_centroid(brachialis, upper_dir, "max", 0.04))],
            "via_points": [attach("upper_arm_l", near_level(brachialis, L_up - 0.025, side="anterior"))],
            "joints_crossed": ["elbow_left"],
            "function": ["肘關節屈曲（主要屈肘肌）"],
            "innervation": "Musculocutaneous nerve (C5–C6)；外側部分常見橈神經分支",
            "activation": 0, "deformation_profile": "fusiform_v1",
            "morphs": {"contract": "contract", "stretch": "stretch"}, "source": SRC,
        },
        {
            "id": "triceps_brachii_left", "name": "Triceps Brachii", "name_zh": "左側肱三頭肌", "name_latin": "Musculus triceps brachii",
            "side": "left", "region": "upper_arm", "architecture": "multihead", "mesh": "triceps_brachii_left",
            "origin": [attach("shoulder_l", end_centroid(triceps, upper_dir, "min", 0.03))],
            "insertion": [attach("forearm_l", end_centroid(triceps, upper_dir, "max", 0.03))],
            "via_points": [attach("upper_arm_l", near_level(triceps, L_up - 0.02, side="posterior"))],
            "joints_crossed": ["shoulder_left", "elbow_left"],
            "function": ["肘關節伸展", "長頭輔助肩關節伸展與內收"],
            "innervation": "Radial nerve (C6–C8)",
            "activation": 0, "deformation_profile": "fusiform_v1",
            "morphs": {"contract": "contract", "stretch": "stretch"}, "source": SRC,
        },
    ],
}
os.makedirs(os.path.dirname(OUT_MANIFEST), exist_ok=True)
with open(OUT_MANIFEST, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

# ------------------------------------------------------------------ export
scene["dha_asset"] = "arm_zanatomy_l"
scene["dha_license"] = "CC-BY-SA-4.0"
if OUT_BLEND:
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format="GLB", use_selection=False, export_yup=True, export_apply=False,
    export_skins=True, export_morph=True, export_morph_normal=True, export_extras=True, export_animations=False,
)
print("DHA_EXPORT_OK", OUT_GLB)
