"""
build_upper_limbs.py — 以 Z-Anatomy 幾何建立「雙側上肢」動態 Rig（含肩胛、鎖骨、手部骨骼、前臂肌群）

用法：
  blender -b --factory-startup --python build_upper_limbs.py -- <in.glb> <parts.json> <out.glb> <manifest.json> [<out.blend>]

骨架（每側 s = l / r）：
  chest → shoulder_s（鎖骨胸骨端→肩關節）→ upper_arm_s → forearm_s → hand_s
關節：shoulder_{left,right}（3 DOF）、elbow_*（1 DOF）、wrist_*（2 DOF）
旋轉軸全部由幾何推算，左右兩側各自計算，因此自動鏡像。

授權：幾何為 Z-Anatomy（CC BY-SA 4.0，衍生自 BodyParts3D CC BY-SA 2.1 JP），輸出同為 CC BY-SA 4.0。
附著點、關節中心為由網格推算的近似值（confidence=approximate）。
"""
import bpy
import json
import math
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
IN_GLB, PARTS_JSON, OUT_GLB, OUT_MANIFEST = (os.path.abspath(a) for a in argv[:4])
OUT_BLEND = os.path.abspath(argv[4]) if len(argv) > 4 else None
CFG = json.load(open(PARTS_JSON, encoding="utf-8"))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=IN_GLB)

UP = Vector((0, 0, 1))
ANTERIOR = Vector((0, -1, 0))  # Blender：人體前方 = -Y
SIDES = {"l": ("left", 1.0), "r": ("right", -1.0)}  # 左側在 +X


# ------------------------------------------------------------------ helpers
def smoothstep(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def centroid(pts):
    s = Vector((0, 0, 0))
    for p in pts:
        s += p
    return s / max(1, len(pts))


def verts(o):
    return [v.co.copy() for v in o.data.vertices]


def end_centroid(o, axis, which, frac):
    vs = sorted(verts(o), key=lambda v: v.dot(axis))
    n = max(3, int(len(vs) * frac))
    return centroid(vs[-n:] if which == "max" else vs[:n])


def bl_to_gl(v):
    return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]


def axis_gl(v):
    v = Vector(bl_to_gl(v)).normalized()
    return [round(v.x, 5), round(v.y, 5), round(v.z, 5)]


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


# 所有 mesh 套用變換，並以原始名稱索引
by_source = {}
for o in list(bpy.data.objects):
    if o.type == "MESH":
        select_only([o])
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        by_source[o.get("sourceName") or o.name] = o
    elif o.type == "EMPTY":
        bpy.data.objects.remove(o)


def take(parts, suffix, name):
    objs = [by_source.pop(f"{p}.{suffix}") for p in parts if f"{p}.{suffix}" in by_source]
    missing = [p for p in parts if not any(o.get("sourceName", o.name) == f"{p}.{suffix}" for o in objs)]
    if not objs:
        raise RuntimeError(f"{name}: 找不到任何零件 {parts}")
    if missing:
        print(f"WARN {name}: 缺少 {missing}")
    select_only(objs)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    for k in ("sourceLayer", "sourceName"):
        if k in o.keys():
            del o[k]
    return o


# ------------------------------------------------------------------ armature（先建立 chest）
arm_data = bpy.data.armatures.new("UpperLimbRig")
arm_obj = bpy.data.objects.new("UpperLimbRig", arm_data)
scene.collection.objects.link(arm_obj)

sides = {}
for s, (side, sign) in SIDES.items():
    objs = {key: take(b["parts"], s, f"{key}_{side}") for key, b in CFG["bones"].items()}
    humerus, radius, clavicle, hand_sk = objs["humerus"], objs["radius"], objs["clavicle"], objs["hand_skeleton"]
    lateral = Vector((sign, 0, 0))

    h_top = end_centroid(humerus, UP, "max", 0.08)
    h_bot = end_centroid(humerus, UP, "min", 0.06)
    hum_axis = (h_top - h_bot).normalized()
    shoulder_c = end_centroid(humerus, hum_axis, "max", 0.07)
    elbow_c = end_centroid(humerus, hum_axis, "min", 0.05)
    r_top = end_centroid(radius, UP, "max", 0.08)
    r_bot = end_centroid(radius, UP, "min", 0.08)
    wrist_c = end_centroid(radius, (r_top - r_bot).normalized(), "min", 0.06)
    fore_dir = (wrist_c - elbow_c).normalized()
    upper_dir = (elbow_c - shoulder_c).normalized()
    hand_tip = end_centroid(hand_sk, fore_dir, "max", 0.03)
    hand_dir = (hand_tip - wrist_c).normalized()
    sternal = end_centroid(clavicle, lateral, "min", 0.08)
    print(f"LANDMARK {side} shoulder={tuple(round(x, 3) for x in shoulder_c)} elbow={tuple(round(x, 3) for x in elbow_c)} wrist={tuple(round(x, 3) for x in wrist_c)}")
    sides[s] = dict(side=side, sign=sign, lateral=lateral, objs=objs, shoulder=shoulder_c, elbow=elbow_c, wrist=wrist_c,
                    hand_tip=hand_tip, sternal=sternal, upper_dir=upper_dir, fore_dir=fore_dir, hand_dir=hand_dir)

chest_top = (sides["l"]["sternal"] + sides["r"]["sternal"]) / 2
chest_base = chest_top - Vector((0, 0, 0.18))

select_only([arm_obj])
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones.new("chest")
eb.head, eb.tail = chest_base, chest_top
BONE_NAMES = ["chest"]
for s, d in sides.items():
    chain = [
        (f"shoulder_{s}", d["sternal"], d["shoulder"], "chest", False),
        (f"upper_arm_{s}", d["shoulder"], d["elbow"], f"shoulder_{s}", True),
        (f"forearm_{s}", d["elbow"], d["wrist"], f"upper_arm_{s}", True),
        (f"hand_{s}", d["wrist"], d["hand_tip"], f"forearm_{s}", True),
    ]
    for name, head, tail, parent, connect in chain:
        b = arm_data.edit_bones.new(name)
        b.head, b.tail = head, tail
        b.align_roll(ANTERIOR)
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = connect
        BONE_NAMES.append(name)
bpy.ops.object.mode_set(mode="OBJECT")

SEG_BONE = {"shoulder": "shoulder_{}", "upper": "upper_arm_{}", "fore": "forearm_{}", "hand": "hand_{}"}


def bind(o, weight_fn):
    o.parent = arm_obj
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj
    groups = {}
    for v in o.data.vertices:
        w = weight_fn(v.co)
        total = sum(w.values()) or 1.0
        for bone, val in w.items():
            if val > 1e-4:
                if bone not in groups:
                    groups[bone] = o.vertex_groups.new(name=bone)
                groups[bone].add([v.index], val / total, "REPLACE")


def muscle_weight_fn(d, s, m):
    L = (d["elbow"] - d["shoulder"]).length
    n_elbow = (d["upper_dir"] + d["fore_dir"]).normalized()
    e_lo, e_hi = m.get("elbow_blend", [-0.02, 0.01])
    wb = m.get("wrist_blend")
    from_shoulder = m["origin"] == "shoulder"

    def f(p):
        w_fore = smoothstep(e_lo, e_hi, (p - d["elbow"]).dot(n_elbow))
        w_hand = smoothstep(wb[0], wb[1], (p - d["wrist"]).dot(d["fore_dir"])) if wb else 0.0
        w_sh = (1.0 - smoothstep(-0.06, 0.04, (p - d["shoulder"]).dot(d["upper_dir"]) / L)) if from_shoulder else 0.0
        return {
            f"shoulder_{s}": w_sh * (1 - w_fore),
            f"upper_arm_{s}": (1 - w_sh) * (1 - w_fore),
            f"forearm_{s}": w_fore * (1 - w_hand),
            f"hand_{s}": w_fore * w_hand,
        }
    return f


def bump(t, a=0.08, b=0.85, p=1.2):
    if t <= a or t >= b:
        return 0.0
    return math.sin(math.pi * (t - a) / (b - a)) ** p


def add_shape_keys(o, axis, gain_contract, gain_stretch, shorten=0.04):
    vs = verts(o)
    proj = [v.dot(axis) for v in vs]
    lo, hi = min(proj), max(proj)
    nb = 24
    bins = [[] for _ in range(nb)]
    for v, p in zip(vs, proj):
        bins[min(nb - 1, int((p - lo) / (hi - lo + 1e-9) * nb))].append(v)
    cents = [centroid(b) if b else None for b in bins]
    last = next(c for c in cents if c is not None)
    for i in range(nb):  # 空 bin 沿用前一個
        if cents[i] is None:
            cents[i] = last
        last = cents[i]
    mid = (lo + hi) / 2

    def center_at(p):
        x = (p - lo) / (hi - lo + 1e-9) * nb - 0.5
        i0 = max(0, min(nb - 1, int(math.floor(x))))
        i1 = min(nb - 1, i0 + 1)
        return cents[i0].lerp(cents[i1], max(0.0, min(1.0, x - i0)))

    o.shape_key_add(name="Basis", from_mix=False)
    kc = o.shape_key_add(name="contract", from_mix=False)
    ks = o.shape_key_add(name="stretch", from_mix=False)
    for i, (v, p) in enumerate(zip(vs, proj)):
        t = (p - lo) / (hi - lo + 1e-9)
        radial = v - center_at(p)
        radial -= axis * radial.dot(axis)
        b = bump(t)
        kc.data[i].co = v + radial * (gain_contract * b) + axis * ((mid - p) * shorten * b)
        ks.data[i].co = v - radial * (gain_stretch * b)


def material(name, rgba, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = rough
    return m


MAT_BONE = material("mat_bone", (0.9, 0.86, 0.76, 1), 0.55)
MAT_MUSCLE = material("mat_muscle", (0.68, 0.15, 0.13, 1), 0.45)


def finish(o, cat):
    o.data.materials.clear()
    o.data.materials.append(MAT_BONE if cat == "bone" else MAT_MUSCLE)
    for p in o.data.polygons:
        p.use_smooth = True
    o["anatomicalId"] = o.name
    o["category"] = cat


# ------------------------------------------------------------------ manifest helpers
def section_point(o, point, axis, side_dir, half=0.012):
    """取穿過 point、法向 axis 的截面附近頂點；side_dir 指定只取前/後側"""
    pts = [v for v in verts(o) if abs((v - point).dot(axis)) <= half]
    if not pts:
        return point
    c = centroid(pts)
    if side_dir is not None:
        pts = [p for p in pts if (p - c).dot(side_dir) > 0] or pts
    return centroid(pts)


SRC = {
    "dataset": "Z-Anatomy (via anatomy-explorer export)",
    "license": "CC-BY-SA-4.0",
    "attribution": "Z-Anatomy – The libre 3D atlas of anatomy (CC BY-SA 4.0), derived from BodyParts3D © The Database Center for Life Science (CC BY-SA 2.1 JP). Rigging, shape keys and attachment estimates by DHA.",
    "url": "https://github.com/Z-Anatomy/Models-of-human-anatomy",
    "derivedFrom": "anatomy-explorer public/models/{skeleton,muscles}.glb",
}

joints, muscles, structures = [], [], []
for s, d in sides.items():
    side, sign, lateral = d["side"], d["sign"], d["lateral"]
    # 骨骼：剛性綁定
    for key, o in d["objs"].items():
        seg = CFG["bones"][key]["bone"]
        bone_name = SEG_BONE[seg].format(s)
        bind(o, lambda p, b=bone_name: {b: 1.0})
        finish(o, "bone")
        structures.append({"id": o.name, "name": CFG["bones"][key]["name"], "name_zh": ("左側" if s == "l" else "右側") + CFG["bones"][key]["name_zh"], "category": "bone", "side": side})

    # 關節（軸 = 骨段方向 × 目標方向）
    ud, fd, hd = d["upper_dir"], d["fore_dir"], d["hand_dir"]
    joints += [
        {"id": f"shoulder_{side}", "bone": f"upper_arm_{s}", "side": side, "center": bl_to_gl(d["shoulder"]), "restDeg": [0, 0, 0],
         "limits": [
             {"axis": "x", "minDeg": -50, "maxDeg": 170, "confidence": "approximate", "vector": axis_gl(ud.cross(ANTERIOR)), "label": "屈曲(+)/伸展(−)"},
             {"axis": "z", "minDeg": -20, "maxDeg": 170, "confidence": "approximate", "vector": axis_gl(ud.cross(lateral)), "label": "外展(+)/內收(−)"},
             {"axis": "y", "minDeg": -90, "maxDeg": 70, "confidence": "approximate", "vector": axis_gl(ud * sign), "label": "內旋(+)/外旋(−)"},
         ]},
        {"id": f"elbow_{side}", "bone": f"forearm_{s}", "side": side, "center": bl_to_gl(d["elbow"]), "restDeg": [0],
         "limits": [{"axis": "x", "minDeg": 0, "maxDeg": 145, "confidence": "approximate", "vector": axis_gl(fd.cross(ANTERIOR).normalized()), "label": "屈曲"}]},
        {"id": f"wrist_{side}", "bone": f"hand_{s}", "side": side, "center": bl_to_gl(d["wrist"]), "restDeg": [0, 0],
         "limits": [
             {"axis": "x", "minDeg": -70, "maxDeg": 80, "confidence": "approximate", "vector": axis_gl(hd.cross(ANTERIOR).normalized()), "label": "掌屈(+)/背伸(−)"},
             {"axis": "z", "minDeg": -30, "maxDeg": 20, "confidence": "approximate", "vector": axis_gl(hd.cross(lateral).normalized()), "label": "橈偏(+)/尺偏(−)"},
         ]},
    ]

    # 肌肉
    for m in CFG["muscles"]:
        name = f"{m['id']}_{side}"
        o = take(m["parts"], s, name)
        axis = ud if m["segment"] == "upper" else fd
        bind(o, muscle_weight_fn(d, s, m))
        add_shape_keys(o, axis, m["shape"][0], m["shape"][1])
        finish(o, "muscle")
        via = []
        if m.get("via"):
            v = m["via"]
            side_dir = ANTERIOR if v["side"] == "anterior" else -ANTERIOR
            if v["at"] == "elbow":
                pt = d["elbow"] - ud * 0.03 if v["bone"] == "upper" else d["elbow"] + fd * 0.03
                ax = ud if v["bone"] == "upper" else fd
            else:
                pt, ax = d["wrist"] - fd * 0.02, fd
            via = [{"bone": SEG_BONE[v["bone"]].format(s), "position": bl_to_gl(section_point(o, pt, ax, side_dir)), "confidence": "approximate"}]
        prox_axis = ud
        entry = {
            "id": name, "name": m["name"], "name_zh": ("左側" if s == "l" else "右側") + m["name_zh"], "name_latin": m["name_latin"],
            "side": side, "region": m["region"], "architecture": m["architecture"], "mesh": name,
            "origin": [{"bone": SEG_BONE[m["origin"]].format(s), "position": bl_to_gl(end_centroid(o, prox_axis if m["segment"] == "upper" else fd, "min", 0.03)), "confidence": "approximate"}],
            "insertion": [{"bone": SEG_BONE[m["insertion"]].format(s), "position": bl_to_gl(end_centroid(o, prox_axis if m["segment"] == "upper" else fd, "max", 0.03)), "confidence": "approximate"}],
            "via_points": via,
            "joints_crossed": [f"{j}_{side}" for j in m["joints"]],
            "function": m["function"], "innervation": m["innervation"],
            "activation": 0, "deformation_profile": "fusiform_v1",
            "morphs": {"contract": "contract", "stretch": "stretch"}, "source": SRC,
        }
        if m.get("members"):
            entry["members"] = m["members"]
        muscles.append(entry)

left = [k for k in by_source]
if left:
    print("WARN 未使用零件：", left)

manifest = {
    "version": "0.3.0",
    "note": "Generated by tools/blender/build_upper_limbs.py. Geometry: Z-Anatomy (CC BY-SA 4.0). Joint centers/axes and attachments are estimated from mesh geometry (approximate); ranges of motion are approximate textbook values, not measured data.",
    "coordinateSystem": {"up": "Y", "forward": "+Z", "unit": "meter", "handedness": "right"},
    "joints": joints,
    "muscles": muscles,
    "structures": structures,
}
os.makedirs(os.path.dirname(OUT_MANIFEST), exist_ok=True)
with open(OUT_MANIFEST, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

scene["dha_asset"] = "upper_limbs"
scene["dha_license"] = "CC-BY-SA-4.0"
if OUT_BLEND:
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format="GLB", use_selection=False, export_yup=True, export_apply=False,
    export_skins=True, export_morph=True, export_morph_normal=True, export_extras=True, export_animations=False,
)
print("DHA_EXPORT_OK", OUT_GLB, f"muscles={len(muscles)} joints={len(joints)}")
