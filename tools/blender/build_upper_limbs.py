"""
build_upper_limbs.py — 以 Z-Anatomy 幾何建立「雙側上肢」動態 Rig（含肩胛、鎖骨、手指骨段、前臂與手內在肌）

用法：
  blender -b --factory-startup --python build_upper_limbs.py -- <in.glb> <parts.json> <out.glb> <manifest.json> [<out.blend>]

骨架（每側 s = l / r）：
  chest → shoulder_s（鎖骨胸骨端→肩關節）→ upper_arm_s → forearm_s → hand_s（腕骨 + 第 2–5 掌骨）
  hand_s → thumb_mc_s → thumb_prox_s → thumb_dist_s
  hand_s → {index,middle,ring,little}_{prox,mid,dist}_s
關節：shoulder（3 DOF）、elbow（1）、wrist（2）、thumb_cmc（2）、thumb_mcp / thumb_ip（1）、
      {finger}_mcp / _pip / _dip（1）
旋轉軸全部由幾何推算，左右兩側各自計算，因此自動鏡像。正角度一律為「屈曲」方向。

另輸出 grips：握把中心、軸向與手指骨段端點，供前端做「逐關節收合直到接觸握把」的握持求解。

授權：幾何為 Z-Anatomy（CC BY-SA 4.0，衍生自 BodyParts3D CC BY-SA 2.1 JP），輸出同為 CC BY-SA 4.0。
附著點、關節中心為由網格推算的近似值（confidence=approximate）。
"""
import bpy
import json
import math
import os
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
IN_GLB, PARTS_JSON, OUT_GLB, OUT_MANIFEST = (os.path.abspath(a) for a in argv[:4])
OUT_BLEND = os.path.abspath(argv[4]) if len(argv) > 4 else None
CFG = json.load(open(PARTS_JSON, encoding="utf-8"))
FINGERS = CFG.get("fingers", {})
GRIP = CFG.get("grip", {"radius": 0.015, "palm_offset": 0.016})
FINGER_PARTS = {part for f in FINGERS.values() for _, part in f["segments"]}
SEG_IDS = [sid for f in FINGERS.values() for sid, _ in f["segments"]]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=IN_GLB)

UP = Vector((0, 0, 1))
ANTERIOR = Vector((0, -1, 0))  # Blender：人體前方 = -Y
SIDES = {"l": ("left", 1.0), "r": ("right", -1.0)}  # 左側在 +X

# 手指關節活動範圍（教科書近似值，度）
FINGER_LIMITS = {
    "mcp": (-20, 90, "屈曲(+)/伸展(−)"),
    "pip": (0, 100, "屈曲"),
    "dip": (-5, 80, "屈曲"),
    "thumb_mcp": (-10, 60, "屈曲"),
    "thumb_ip": (-15, 80, "屈曲"),
}


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


def principal_axis(pts):
    """主成分方向（power iteration）"""
    c = centroid(pts)
    m = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
    for p in pts:
        d = p - c
        for i in range(3):
            for j in range(3):
                m[i][j] += d[i] * d[j]
    a = Vector((0.3, 0.5, 0.8)).normalized()
    for _ in range(60):
        a = (m @ a).normalized()
    return c, a


def perp_unit(v, ref):
    """ref 去掉 v 方向分量後的單位向量"""
    r = ref - v * ref.dot(v)
    return r.normalized()


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


def rnd(v):
    return tuple(round(x, 3) for x in v)


# ------------------------------------------------------------------ armature（先建立 chest）
arm_data = bpy.data.armatures.new("UpperLimbRig")
arm_obj = bpy.data.objects.new("UpperLimbRig", arm_data)
scene.collection.objects.link(arm_obj)

sides = {}
for s, (side, sign) in SIDES.items():
    objs = {}
    for key, b in CFG["bones"].items():
        parts = [p for p in b["parts"] if p not in FINGER_PARTS] if key == "hand_skeleton" else b["parts"]
        objs[key] = take(parts, s, f"{key}_{side}")
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
    hand_tip = end_centroid(hand_sk, fore_dir, "max", 0.03)  # 掌骨頭附近
    hand_dir = (hand_tip - wrist_c).normalized()
    sternal = end_centroid(clavicle, lateral, "min", 0.08)
    print(f"LANDMARK {side} shoulder={rnd(shoulder_c)} elbow={rnd(elbow_c)} wrist={rnd(wrist_c)} hand_tip={rnd(hand_tip)}")

    # ---- 手指骨段：每段一個物件，主軸由 PCA 推算並統一指向遠端
    segs, seg_geo = {}, {}
    for fname, f in FINGERS.items():
        for sid, part in f["segments"]:
            o = take([part], s, f"{sid}_{side}")
            segs[sid] = o
            c, a = principal_axis(verts(o))
            if a.dot(c - wrist_c) < 0:
                a = -a
            seg_geo[sid] = (end_centroid(o, a, "min", 0.06), end_centroid(o, a, "max", 0.06), a)
    seg_bones, seg_dir = {}, {}
    for fname, f in FINGERS.items():
        ids = [sid for sid, _ in f["segments"]]
        centers = []
        for i, sid in enumerate(ids):
            h, _, a = seg_geo[sid]
            if i == 0:
                # 基部關節中心落在近端骨（掌骨頭 / 大多角骨）內，略往近端內移
                centers.append(h - a * (0.004 if fname == "thumb" else 0.006))
            else:
                centers.append((seg_geo[ids[i - 1]][1] + h) / 2)
        for i, sid in enumerate(ids):
            head = centers[i]
            tail = centers[i + 1] if i + 1 < len(ids) else seg_geo[sid][1]
            seg_bones[sid] = (head, tail)
            seg_dir[sid] = (tail - head).normalized()
        print(f"LANDMARK {side} {fname} " + " ".join(f"{sid}={rnd(seg_bones[sid][0])}" for sid in ids))

    # ---- 握把：第 2–5 指 MCP 連線、掌心法向
    mcp = {fn: seg_bones[FINGERS[fn]["segments"][0][0]][0] for fn in ("index", "little") if fn in FINGERS}
    grip = None
    if len(mcp) == 2:
        g_axis = (mcp["index"] - mcp["little"]).normalized()
        palm_n = hand_dir.cross(g_axis).normalized()
        if palm_n.dot(ANTERIOR) < 0:
            palm_n = -palm_n
        g_center = (mcp["index"] + mcp["little"]) / 2 - hand_dir * 0.01 + palm_n * (GRIP["radius"] + GRIP["palm_offset"])
        grip = dict(center=g_center, axis=g_axis, palm_n=palm_n)
        print(f"LANDMARK {side} grip center={rnd(g_center)} axis={rnd(g_axis)} palm_n={rnd(palm_n)}")

    sides[s] = dict(side=side, sign=sign, lateral=lateral, objs=objs, segs=segs, seg_bones=seg_bones, seg_dir=seg_dir,
                    shoulder=shoulder_c, elbow=elbow_c, wrist=wrist_c, hand_tip=hand_tip, sternal=sternal,
                    upper_dir=upper_dir, fore_dir=fore_dir, hand_dir=hand_dir, grip=grip)
    sides[s]["hand_bones"] = [(f"hand_{s}", wrist_c, hand_tip)] + [(f"{sid}_{s}", h, t) for sid, (h, t) in seg_bones.items()]

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
    for fname, f in FINGERS.items():
        prev = f"hand_{s}"
        for i, (sid, _) in enumerate(f["segments"]):
            h, t = d["seg_bones"][sid]
            chain.append((f"{sid}_{s}", h, t, prev, i > 0))
            prev = f"{sid}_{s}"
    for name, head, tail, parent, connect in chain:
        b = arm_data.edit_bones.new(name)
        b.head, b.tail = head, tail
        b.align_roll(ANTERIOR)
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = connect
        BONE_NAMES.append(name)
bpy.ops.object.mode_set(mode="OBJECT")

SEG_BONE = {"shoulder": "shoulder_{}", "upper": "upper_arm_{}", "fore": "forearm_{}", "hand": "hand_{}"}


def bone_of(key, s):
    return SEG_BONE[key].format(s) if key in SEG_BONE else f"{key}_{s}"


def add_armature(o):
    o.parent = arm_obj
    mod = o.modifiers.new("Armature", "ARMATURE")
    mod.object = arm_obj


def bind(o, weight_fn):
    add_armature(o)
    groups = {}
    for v in o.data.vertices:
        w = weight_fn(v.co)
        total = sum(w.values()) or 1.0
        for bone, val in w.items():
            if val > 1e-4:
                if bone not in groups:
                    groups[bone] = o.vertex_groups.new(name=bone)
                groups[bone].add([v.index], val / total, "REPLACE")


def rigid_group(o, bone):
    g = o.vertex_groups.new(name=bone)
    g.add([v.index for v in o.data.vertices], 1.0, "REPLACE")


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length


def hand_weights(d, p):
    """手部：依頂點到各骨段（掌 + 指節）的距離做柔性分配"""
    ds = [(n, seg_dist(p, a, b)) for n, a, b in d["hand_bones"]]
    dmin = min(x for _, x in ds)
    return {n: math.exp(-(x - dmin) / 0.003) for n, x in ds if x - dmin < 0.01}


def muscle_weight_fn(d, s, m):
    if m["segment"] == "hand":
        return lambda p: hand_weights(d, p)
    L = (d["elbow"] - d["shoulder"]).length
    n_elbow = (d["upper_dir"] + d["fore_dir"]).normalized()
    e_lo, e_hi = m.get("elbow_blend", [-0.02, 0.01])
    wb = m.get("wrist_blend")
    from_shoulder = m["origin"] == "shoulder"

    def f(p):
        w_fore = smoothstep(e_lo, e_hi, (p - d["elbow"]).dot(n_elbow))
        w_hand = smoothstep(wb[0], wb[1], (p - d["wrist"]).dot(d["fore_dir"])) if wb else 0.0
        w_sh = (1.0 - smoothstep(-0.06, 0.04, (p - d["shoulder"]).dot(d["upper_dir"]) / L)) if from_shoulder else 0.0
        out = {
            f"shoulder_{s}": w_sh * (1 - w_fore),
            f"upper_arm_{s}": (1 - w_sh) * (1 - w_fore),
            f"forearm_{s}": w_fore * (1 - w_hand),
        }
        w_h = w_fore * w_hand
        if w_h > 1e-4:
            hw = hand_weights(d, p)
            tot = sum(hw.values()) or 1.0
            for n, v in hw.items():
                out[n] = out.get(n, 0.0) + w_h * v / tot
        return out
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
        p.material_index = 0
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


def far_centroid(o, ref, frac=0.04):
    """離 ref 最遠的一小群頂點的重心（手內在肌的起點估計）"""
    vs = sorted(verts(o), key=lambda v: (v - ref).length)
    n = max(3, int(len(vs) * frac))
    return centroid(vs[-n:])


SRC = {
    "dataset": "Z-Anatomy (via anatomy-explorer export)",
    "license": "CC-BY-SA-4.0",
    "attribution": "Z-Anatomy – The libre 3D atlas of anatomy (CC BY-SA 4.0), derived from BodyParts3D © The Database Center for Life Science (CC BY-SA 2.1 JP). Rigging, shape keys and attachment estimates by DHA.",
    "url": "https://github.com/Z-Anatomy/Models-of-human-anatomy",
    "derivedFrom": "anatomy-explorer public/models/{skeleton,muscles}.glb",
}


def lim(axis_name, lo, hi, vec, label):
    return {"axis": axis_name, "minDeg": lo, "maxDeg": hi, "confidence": "approximate", "vector": axis_gl(vec), "label": label}


joints, muscles, structures, grips = [], [], [], []
for s, d in sides.items():
    side, sign, lateral = d["side"], d["sign"], d["lateral"]
    zh = "左側" if s == "l" else "右側"
    # 骨骼：剛性綁定；手部骨骼 = 掌（hand_s）+ 各指骨段，合併成一個結構但各自綁到自己的骨骼
    for key, o in d["objs"].items():
        if key == "hand_skeleton":
            rigid_group(o, f"hand_{s}")
            for sid, so in d["segs"].items():
                rigid_group(so, f"{sid}_{s}")
            select_only([o] + list(d["segs"].values()))
            bpy.ops.object.join()
            add_armature(o)
        else:
            bone_name = SEG_BONE[CFG["bones"][key]["bone"]].format(s)
            bind(o, lambda p, b=bone_name: {b: 1.0})
        finish(o, "bone")
        structures.append({"id": o.name, "name": CFG["bones"][key]["name"], "name_zh": zh + CFG["bones"][key]["name_zh"], "category": "bone", "side": side})

    # 關節（軸 = 骨段方向 × 目標方向；正角度 = 朝目標方向轉）
    ud, fd, hd = d["upper_dir"], d["fore_dir"], d["hand_dir"]
    joints += [
        {"id": f"shoulder_{side}", "bone": f"upper_arm_{s}", "side": side, "center": bl_to_gl(d["shoulder"]), "restDeg": [0, 0, 0],
         "limits": [
             lim("x", -50, 170, ud.cross(ANTERIOR), "屈曲(+)/伸展(−)"),
             lim("z", -20, 170, ud.cross(lateral), "外展(+)/內收(−)"),
             lim("y", -90, 70, ud * sign, "內旋(+)/外旋(−)"),
         ]},
        {"id": f"elbow_{side}", "bone": f"forearm_{s}", "side": side, "center": bl_to_gl(d["elbow"]), "restDeg": [0],
         "limits": [lim("x", 0, 145, fd.cross(ANTERIOR).normalized(), "屈曲")]},
        {"id": f"wrist_{side}", "bone": f"hand_{s}", "side": side, "center": bl_to_gl(d["wrist"]), "restDeg": [0, 0],
         "limits": [
             lim("x", -70, 80, hd.cross(ANTERIOR).normalized(), "掌屈(+)/背伸(−)"),
             lim("z", -30, 20, hd.cross(lateral).normalized(), "橈偏(+)/尺偏(−)"),
         ]},
    ]
    finger_chains = []
    for fname, f in FINGERS.items():
        chain = {"id": fname, "name_zh": f["name_zh"], "joints": [], "segments": []}
        for (sid, _), jn in zip(f["segments"], f["joints"]):
            h, t = d["seg_bones"][sid]
            a = d["seg_dir"][sid]
            jid = f"{fname}_{jn}_{side}"
            if fname == "thumb" and jn == "cmc":
                limits = [
                    lim("x", -15, 50, a.cross(perp_unit(a, -lateral)).normalized(), "屈曲(+)/伸展(−)"),
                    lim("z", -10, 60, a.cross(perp_unit(a, ANTERIOR)).normalized(), "掌側外展(+)/內收(−)"),
                ]
            else:
                key = f"thumb_{jn}" if fname == "thumb" else jn
                lo, hi, label = FINGER_LIMITS[key]
                n = perp_unit(a, (ANTERIOR - lateral).normalized()) if fname == "thumb" else perp_unit(a, ANTERIOR)
                limits = [lim("x", lo, hi, a.cross(n).normalized(), label)]
            joints.append({"id": jid, "bone": f"{sid}_{s}", "side": side, "center": bl_to_gl(h), "restDeg": [0] * len(limits),
                           "group": "finger", "limits": limits})
            chain["joints"].append(jid)
            chain["segments"].append({"bone": f"{sid}_{s}", "head": bl_to_gl(h), "tail": bl_to_gl(t)})
        finger_chains.append(chain)
    if d["grip"]:
        g = d["grip"]
        grips.append({
            "id": f"grip_{side}", "side": side, "bone": f"hand_{s}", "center": bl_to_gl(g["center"]), "axis": axis_gl(g["axis"]),
            "palmNormal": axis_gl(g["palm_n"]), "radius": GRIP["radius"], "fingerRadius": 0.008, "confidence": "approximate",
            "fingers": finger_chains,
        })

    # 肌肉
    for m in CFG["muscles"]:
        name = f"{m['id']}_{side}"
        o = take(m["parts"], s, name)
        ins_key = m["insertion"]
        ins_pt = None
        if ins_key in d["seg_bones"]:
            h, t = d["seg_bones"][ins_key]
            ins_pt = h.lerp(t, m.get("insertion_at", 0.5)) + perp_unit(d["seg_dir"][ins_key], ANTERIOR) * m.get("insertion_offset", 0.004)
        if m["segment"] == "hand":
            org_pt = far_centroid(o, ins_pt) if ins_pt is not None else end_centroid(o, hd, "min", 0.03)
            axis = ((ins_pt if ins_pt is not None else end_centroid(o, hd, "max", 0.03)) - org_pt).normalized()
        else:
            axis = ud if m["segment"] == "upper" else fd
            org_pt = end_centroid(o, axis, "min", 0.03)
        if ins_pt is None:
            ins_pt = end_centroid(o, axis, "max", 0.03)
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
            via = [{"bone": bone_of(v["bone"], s), "position": bl_to_gl(section_point(o, pt, ax, side_dir)), "confidence": "approximate"}]
        entry = {
            "id": name, "name": m["name"], "name_zh": zh + m["name_zh"], "name_latin": m["name_latin"],
            "side": side, "region": m["region"], "architecture": m["architecture"], "mesh": name,
            "origin": [{"bone": bone_of(m["origin"], s), "position": bl_to_gl(org_pt), "confidence": "approximate"}],
            "insertion": [{"bone": bone_of(ins_key, s), "position": bl_to_gl(ins_pt), "confidence": "approximate"}],
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
    "version": "0.4.0",
    "note": "Generated by tools/blender/build_upper_limbs.py. Geometry: Z-Anatomy (CC BY-SA 4.0). Joint centers/axes, attachments and grip geometry are estimated from mesh geometry (approximate); ranges of motion are approximate textbook values, not measured data.",
    "coordinateSystem": {"up": "Y", "forward": "+Z", "unit": "meter", "handedness": "right"},
    "joints": joints,
    "muscles": muscles,
    "structures": structures,
    "grips": grips,
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
print("DHA_EXPORT_OK", OUT_GLB, f"muscles={len(muscles)} joints={len(joints)} bones={len(BONE_NAMES)} grips={len(grips)}")
