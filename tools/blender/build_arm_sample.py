"""
build_arm_sample.py — 程序化產生左上肢動態樣本（Phase 3 技術驗證用）

用法（由 tools/blender/run-blender.mjs 呼叫）：
  blender -b --factory-startup --python build_arm_sample.py -- <out.glb> [<out.blend>]

座標（Blender 端）：Z-up、身體面向 -Y、左臂沿 +X 伸直（T-pose）。
glTF 匯出 (+Y up) 後：手臂沿 +X、前方(anterior) = +Z、上方 = +Y。

產出：
  骨架  shoulder_l → upper_arm_l → forearm_l → hand_l（肘關節位於 x=0.30）
  Mesh  humerus_left / radius_left / ulna_left / biceps_brachii_left /
        triceps_brachii_left / skin_arm_left
  Shape Keys（肌肉）：contract、stretch
  所有 Mesh 名稱 = anatomicalId，並以 extras.anatomicalId 標記。

注意：此為「幾何示意樣本」，尺寸與附著點為 placeholder，非真實解剖數據。
"""
import bpy
import math
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB = os.path.abspath(argv[0]) if argv else os.path.abspath("arm_sample.glb")
OUT_BLEND = os.path.abspath(argv[1]) if len(argv) > 1 else None

ELBOW_X = 0.30
WRIST_X = 0.55
HAND_END_X = 0.65

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------------------------------------------------------------- helpers
def smoothstep(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def bump(t, a, b, p=0.8):
    """0 在 [a,b] 外，中段為 1 的肌腹輪廓"""
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a)) ** p


# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("ArmRig")
arm_obj = bpy.data.objects.new("ArmRig", arm_data)
scene.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")

BONES = [
    # name, head, tail, parent
    ("shoulder_l", (-0.04, 0.0, 0.0), (0.0, 0.0, 0.0), None),
    ("upper_arm_l", (0.0, 0.0, 0.0), (ELBOW_X, 0.0, 0.0), "shoulder_l"),
    ("forearm_l", (ELBOW_X, 0.0, 0.0), (WRIST_X, 0.0, 0.0), "upper_arm_l"),
    ("hand_l", (WRIST_X, 0.0, 0.0), (HAND_END_X, 0.0, 0.0), "forearm_l"),
]
for name, head, tail, parent in BONES:
    eb = arm_data.edit_bones.new(name)
    eb.head = head
    eb.tail = tail
    eb.roll = 0.0
    if parent:
        eb.parent = arm_data.edit_bones[parent]
        eb.use_connect = True
bpy.ops.object.mode_set(mode="OBJECT")
arm_obj.select_set(False)


# ---------------------------------------------------------------- tube mesh builder
def build_tube(name, x0, x1, radius_fn, center_fn, weight_fn, segments=24, rings=48,
               shape_keys=None, anatomical_id=None, category="muscle"):
    """
    radius_fn(t) -> (ry, rz)
    center_fn(t) -> (cy, cz)
    weight_fn(x) -> dict{bone: weight}
    shape_keys: dict{name: fn(t, ry, rz, cy, cz) -> (ry, rz, cy, cz)}
    """
    params = []
    verts = []
    for i in range(rings + 1):
        t = i / rings
        x = x0 + (x1 - x0) * t
        ry, rz = radius_fn(t)
        cy, cz = center_fn(t)
        for s in range(segments):
            a = 2 * math.pi * s / segments
            params.append((t, x, a))
            verts.append((x, cy + ry * math.cos(a), cz + rz * math.sin(a)))
    cap0 = len(verts)
    cy0, cz0 = center_fn(0.0)
    verts.append((x0, cy0, cz0))
    params.append((0.0, x0, None))
    cap1 = len(verts)
    cy1, cz1 = center_fn(1.0)
    verts.append((x1, cy1, cz1))
    params.append((1.0, x1, None))

    faces = []
    for i in range(rings):
        for s in range(segments):
            a = i * segments + s
            b = i * segments + (s + 1) % segments
            c = (i + 1) * segments + (s + 1) % segments
            d = (i + 1) * segments + s
            faces.append((a, d, c, b))
    for s in range(segments):
        faces.append((cap0, s, (s + 1) % segments))
        base = rings * segments
        faces.append((cap1, base + (s + 1) % segments, base + s))

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    obj.parent = arm_obj
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj

    # vertex groups (skin weights)
    groups = {b[0]: obj.vertex_groups.new(name=b[0]) for b in BONES}
    for idx, (t, x, _a) in enumerate(params):
        w = weight_fn(x)
        total = sum(w.values()) or 1.0
        for bone, val in w.items():
            if val > 1e-5:
                groups[bone].add([idx], val / total, "REPLACE")

    # shape keys
    if shape_keys:
        obj.shape_key_add(name="Basis", from_mix=False)
        for key_name, fn in shape_keys.items():
            kb = obj.shape_key_add(name=key_name, from_mix=False)
            for idx, (t, x, a) in enumerate(params):
                ry, rz = radius_fn(t)
                cy, cz = center_fn(t)
                ry2, rz2, cy2, cz2 = fn(t, ry, rz, cy, cz)
                if a is None:
                    kb.data[idx].co = (x, cy2, cz2)
                else:
                    kb.data[idx].co = (x, cy2 + ry2 * math.cos(a), cz2 + rz2 * math.sin(a))

    obj["anatomicalId"] = anatomical_id or name
    obj["category"] = category
    return obj


def material(name, rgba, alpha_blend=False, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = rgba
        bsdf.inputs["Roughness"].default_value = rough
        if alpha_blend:
            bsdf.inputs["Alpha"].default_value = rgba[3]
    if alpha_blend:
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
    return m


MAT_BONE = material("mat_bone", (0.92, 0.88, 0.78, 1.0), rough=0.5)
MAT_MUSCLE_BI = material("mat_biceps", (0.72, 0.16, 0.14, 1.0), rough=0.45)
MAT_MUSCLE_TRI = material("mat_triceps", (0.62, 0.12, 0.13, 1.0), rough=0.45)
MAT_SKIN = material("mat_skin", (0.93, 0.74, 0.62, 0.35), alpha_blend=True, rough=0.7)


def rigid(bone):
    return lambda x: {bone: 1.0}


def blend(b0, b1, e0, e1):
    def f(x):
        w = smoothstep(e0, e1, x)
        return {b0: 1.0 - w, b1: w}
    return f


# ---------------------------------------------------------------- bones (osseous)
def knob_radius(r_shaft, r_end, end_len=0.12):
    def f(t):
        k = max(smoothstep(end_len, 0.0, t), smoothstep(1 - end_len, 1.0, t))
        r = r_shaft + (r_end - r_shaft) * k
        return (r, r)
    return f


humerus = build_tube("humerus_left", 0.0, ELBOW_X - 0.005, knob_radius(0.011, 0.02),
                     lambda t: (0.0, 0.0), rigid("upper_arm_l"),
                     anatomical_id="humerus_left", category="bone")
radius_b = build_tube("radius_left", ELBOW_X + 0.005, WRIST_X, knob_radius(0.007, 0.012),
                      lambda t: (-0.006, -0.004), rigid("forearm_l"),
                      anatomical_id="radius_left", category="bone")
ulna = build_tube("ulna_left", ELBOW_X - 0.012, WRIST_X - 0.01, knob_radius(0.007, 0.011),
                  lambda t: (0.008, -0.006), rigid("forearm_l"),
                  anatomical_id="ulna_left", category="bone")
for o in (humerus, radius_b, ulna):
    o.data.materials.append(MAT_BONE)


# ---------------------------------------------------------------- muscles
# Biceps brachii：前側（-Y），近端起於肩部附近，遠端止於橈骨粗隆（肘關節遠側）
BI_X0, BI_X1 = 0.03, ELBOW_X + 0.035
BI_A, BI_B = 0.12, 0.82


def bi_radius(t):
    b = bump(t, BI_A, BI_B)
    return (0.004 + 0.018 * b, 0.004 + 0.016 * b)


def bi_center(t):
    return (-(0.010 + 0.016 * math.sin(math.pi * t) ** 0.6), 0.002)


def bi_contract(t, ry, rz, cy, cz):
    b = bump(t, BI_A, BI_B, 1.4)
    return (ry * (1 + 0.55 * b), rz * (1 + 0.35 * b), cy - 0.010 * b, cz + 0.002 * b)


def bi_stretch(t, ry, rz, cy, cz):
    b = bump(t, BI_A, BI_B, 1.0)
    return (ry * (1 - 0.22 * b), rz * (1 - 0.18 * b), cy + 0.003 * b, cz)


biceps = build_tube("biceps_brachii_left", BI_X0, BI_X1, bi_radius, bi_center,
                    blend("upper_arm_l", "forearm_l", ELBOW_X - 0.03, ELBOW_X + 0.01),
                    shape_keys={"contract": bi_contract, "stretch": bi_stretch},
                    anatomical_id="biceps_brachii_left")
biceps.data.materials.append(MAT_MUSCLE_BI)

# Triceps brachii：後側（+Y），止於尺骨鷹嘴（肘關節略遠側後方）
TRI_X0, TRI_X1 = 0.02, ELBOW_X + 0.012
TRI_A, TRI_B = 0.06, 0.78


def tri_radius(t):
    b = bump(t, TRI_A, TRI_B)
    return (0.005 + 0.019 * b, 0.006 + 0.019 * b)


def tri_center(t):
    return (0.010 + 0.017 * math.sin(math.pi * min(1.0, t * 1.1)) ** 0.6, 0.0)


def tri_contract(t, ry, rz, cy, cz):
    b = bump(t, TRI_A, TRI_B, 1.4)
    return (ry * (1 + 0.40 * b), rz * (1 + 0.30 * b), cy + 0.008 * b, cz)


def tri_stretch(t, ry, rz, cy, cz):
    b = bump(t, TRI_A, TRI_B, 1.0)
    return (ry * (1 - 0.20 * b), rz * (1 - 0.15 * b), cy - 0.003 * b, cz)


triceps = build_tube("triceps_brachii_left", TRI_X0, TRI_X1, tri_radius, tri_center,
                     blend("upper_arm_l", "forearm_l", ELBOW_X - 0.012, ELBOW_X + 0.004),
                     shape_keys={"contract": tri_contract, "stretch": tri_stretch},
                     anatomical_id="triceps_brachii_left")
triceps.data.materials.append(MAT_MUSCLE_TRI)


# ---------------------------------------------------------------- skin
def skin_radius(t):
    x = -0.03 + (HAND_END_X + 0.01) * t
    if x < ELBOW_X:
        r = 0.050 - 0.012 * (max(x, 0.0) / ELBOW_X)
    elif x < WRIST_X:
        r = 0.038 - 0.012 * ((x - ELBOW_X) / (WRIST_X - ELBOW_X))
    else:
        r = 0.026
    taper = smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.96, t)
    r = 0.004 + (r - 0.004) * taper
    return (r, r * 0.92)


def skin_weights(x):
    w_f = smoothstep(ELBOW_X - 0.035, ELBOW_X + 0.035, x)
    w_h = smoothstep(WRIST_X - 0.02, WRIST_X + 0.02, x)
    return {"upper_arm_l": 1.0 - w_f, "forearm_l": w_f * (1.0 - w_h), "hand_l": w_h}


skin = build_tube("skin_arm_left", -0.03, HAND_END_X - 0.02, skin_radius, lambda t: (0.0, 0.0),
                  skin_weights, segments=32, rings=80,
                  anatomical_id="skin_arm_left", category="skin")
skin.data.materials.append(MAT_SKIN)

# ---------------------------------------------------------------- metadata & export
scene["dha_asset"] = "arm_sample"
scene["dha_version"] = "0.1.0"
scene["dha_note"] = "Procedural placeholder geometry. Not anatomical reference data."

if OUT_BLEND:
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format="GLB",
    use_selection=False,
    export_yup=True,
    export_apply=False,
    export_skins=True,
    export_morph=True,
    export_morph_normal=True,
    export_extras=True,
    export_animations=False,
)
print("DHA_EXPORT_OK", OUT_GLB)
