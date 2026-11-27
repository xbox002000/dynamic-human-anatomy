"""
body_ext.py — M3 全身骨架擴充。由 build_upper_limbs.py 在 parts.json 含 body 區段時載入，
上肢部分（骨骼、肌肉 morph、握持）完全沿用原腳本，不改動其邏輯。

新增骨架（Blender 座標：+Z 上、−Y 前、+X 左）：
  pelvis（根，髖關節中點 → L5/S1）→ lumbar（L5/S1 → T12/L1）→ chest（T12/L1 → C7/T1）
  → neck（C7/T1 → 寰椎）→ head
  pelvis → thigh_s → shin_s → foot_s → toes_s（s = l / r）
上肢的 shoulder_s 仍掛在 chest 下。

綁定（M3：先 rigid / LBS，不做形變 morph）：
  - 骨骼：每個原始零件剛性跟隨一根骨骼；椎骨依椎體中心到脊柱骨段的距離在相鄰骨骼間柔性分配，
    讓脊柱彎曲時分散到各節。
  - 靜態肌肉：每個頂點取最近的骨骼表面頂點（KD-tree，k=12），沿用該骨骼頂點的權重並依距離加權，
    再沿網格邊做 Laplacian 平滑，避免相鄰頂點跳到不同骨骼而撕裂。最多 4 個影響、總和 = 1。

關節軸一律在 rest pose 由幾何推算，正角度方向與標籤一致；活動範圍為教科書近似值（approximate）。
"""
import math

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree

_NEEDED = ("by_source", "verts", "centroid", "end_centroid", "select_only", "add_armature", "finish",
           "bl_to_gl", "axis_gl", "seg_dist", "lim", "arm_obj", "arm_data", "UP", "ANTERIOR", "SIDES", "SRC",
           "principal_axis", "add_shape_keys", "section_point")
OTHER = {"l": "r", "r": "l"}
MID_BONES = {"pelvis", "lumbar", "chest", "neck", "head"}
MID_JOINTS = {"pelvis", "lumbar", "thoracic", "neck", "head"}
SPINE_BONE_IDS = {"cervical_spine", "thoracic_spine", "lumbar_spine"}
LEFT = Vector((1, 0, 0))


def init(g):
    globals().update({k: g[k] for k in _NEEDED if k in g})


# ------------------------------------------------------------------ parts
def _pop(part, s):
    """s=None：中線結構，收集無後綴與 .l/.r；s='l'/'r'：該側，若該側無後綴則退回無後綴零件"""
    if s is None:
        return [by_source.pop(k) for k in (part, f"{part}.l", f"{part}.r") if k in by_source]
    k = f"{part}.{s}"
    if k in by_source:
        return [by_source.pop(k)]
    if part in by_source and f"{part}.{OTHER[s]}" in by_source:
        return [by_source.pop(part)]  # 少數零件一側沒有 .l 後綴（例：Iliocostalis colli muscle）
    return []


def _src(part, s=None):
    if s is None:
        o = by_source.get(part)
    else:
        o = by_source.get(f"{part}.{s}") or (by_source.get(part) if f"{part}.{OTHER[s]}" in by_source else None)
    if o is None:
        raise RuntimeError(f"找不到地標零件 {part} ({s})")
    return o


def _const_groups(o, weights):
    idx = [v.index for v in o.data.vertices]
    for bone, w in weights.items():
        g = o.vertex_groups.get(bone) or o.vertex_groups.new(name=bone)
        g.add(idx, w, "REPLACE")


def _decimate(o, ratio):
    if not ratio or ratio >= 1 or len(o.data.polygons) < 200:
        return
    mod = o.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    select_only([o])
    bpy.ops.object.modifier_apply(modifier=mod.name)


def _take(parts, s, name, ratio, per_part=None):
    objs, missing = [], []
    for p in parts:
        found = _pop(p, s)
        if not found:
            missing.append(p)
        objs += found
    if missing:
        print(f"WARN {name}: 缺少 {missing}")
    if not objs:
        print(f"WARN {name}: 找不到任何零件，略過")
        return None
    if per_part:
        for o in objs:
            per_part(o)
    select_only(objs)
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = o.data.name = name
    for k in ("sourceLayer", "sourceName"):
        if k in o.keys():
            del o[k]
    _decimate(o, ratio)
    # 合併 / 減面後可能有重複頂點與退化面：清理後再驗證，避免 glTF 匯出警告
    select_only([o])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.delete_loose()
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.dissolve_degenerate(threshold=1e-6)
    bpy.ops.object.mode_set(mode="OBJECT")
    if o.data.validate(clean_customdata=True):
        print(f"FIX {name}: 已修正無效幾何")
    return o


# ------------------------------------------------------------------ landmarks
def landmarks(g, body):
    init(g)
    lm = body["landmarks"]
    sp = {k: centroid(verts(_src(v))) for k, v in lm["spine"].items()}
    L = {
        "j_ls": end_centroid(_src(lm["spine"]["L5"]), UP, "min", 0.15),  # L5/S1
        "j_tl": (sp["T12"] + sp["L1"]) / 2,  # 胸腰交界
        "j_ct": (sp["C7"] + sp["T1"]) / 2,  # 頸胸交界
        "j_ao": sp["C1"],  # 寰枕
        "legs": {},
    }
    for s, (side, sign) in SIDES.items():
        fem, tib, tal = _src("Femur", s), _src("Tibia", s), _src("Talus", s)
        fv = verts(fem)
        ztop = max(v.z for v in fv)
        top = sorted((v for v in fv if v.z > ztop - 0.07), key=lambda v: v.x * sign)
        hip = centroid(top[: max(3, len(top) * 3 // 10)])  # 上端最內側 = 股骨頭
        knee = (end_centroid(fem, UP, "min", 0.04) + end_centroid(tib, UP, "max", 0.04)) / 2
        ankle = centroid(verts(tal))
        mtp = centroid([end_centroid(_src(p, s), ANTERIOR, "max", 0.08) for p in lm["metatarsals"]])
        tip = centroid([end_centroid(_src(p, s), ANTERIOR, "max", 0.1) for p in lm["distal_toes"]])
        L["legs"][s] = dict(hip=hip, knee=knee, ankle=ankle, mtp=mtp, tip=tip)
        print(f"LANDMARK {side} hip={_r(hip)} knee={_r(knee)} ankle={_r(ankle)} mtp={_r(mtp)} toe_tip={_r(tip)}")
    L["pelvis_c"] = (L["legs"]["l"]["hip"] + L["legs"]["r"]["hip"]) / 2
    L["head_tip"] = L["j_ao"] + UP * 0.18
    print(f"LANDMARK spine pelvis={_r(L['pelvis_c'])} L5S1={_r(L['j_ls'])} T12L1={_r(L['j_tl'])} C7T1={_r(L['j_ct'])} C1={_r(L['j_ao'])}")
    return L


def _r(v):
    return tuple(round(x, 3) for x in v)


def _spine_segments(L):
    return [
        ("pelvis", L["pelvis_c"], L["j_ls"]),
        ("lumbar", L["j_ls"], L["j_tl"]),
        ("chest", L["j_tl"], L["j_ct"]),
        ("neck", L["j_ct"], L["j_ao"]),
        ("head", L["j_ao"], L["head_tip"]),
    ]


# ------------------------------------------------------------------ armature（EDIT 模式中呼叫）
def create_bones(g, L):
    init(g)
    eb = arm_data.edit_bones
    names = []

    def add(name, h, t, parent=None, connect=False, roll=None):
        b = eb.new(name)
        b.head, b.tail = h, t
        b.align_roll(roll if roll is not None else ANTERIOR)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        names.append(name)

    prev = None
    for name, h, t in _spine_segments(L):
        add(name, h, t, prev, prev is not None)
        prev = name
    for s in SIDES:
        d = L["legs"][s]
        add(f"thigh_{s}", d["hip"], d["knee"], "pelvis")
        add(f"shin_{s}", d["knee"], d["ankle"], f"thigh_{s}", True)
        add(f"foot_{s}", d["ankle"], d["mtp"], f"shin_{s}", True, UP)
        add(f"toes_{s}", d["mtp"], d["tip"], f"foot_{s}", True, UP)
    return names


# ------------------------------------------------------------------ joints
def _joints(body, L):
    J = body["joints"]
    flex, lat = LEFT, Vector((0, 1, 0))  # 前屈：上端往 −Y；左側屈：上端往 +X；左旋：繞 +Z
    out = []
    for jid, bone, center, key in [("pelvis", "pelvis", L["pelvis_c"], "pelvis"), ("lumbar", "lumbar", L["j_ls"], "lumbar"),
                                   ("thoracic", "chest", L["j_tl"], "thoracic"), ("neck", "neck", L["j_ct"], "neck"),
                                   ("head", "head", L["j_ao"], "head")]:
        c = J[key]
        limits = [lim("x", *c["flex"], flex, c.get("flex_label", "前屈(+)/後伸(−)")),
                  lim("z", *c["lat"], lat, "左側屈(+)/右側屈(−)")]
        if "rot" in c:
            limits.append(lim("y", *c["rot"], UP, "左旋(+)/右旋(−)"))
        out.append({"id": jid, "bone": bone, "side": "midline", "center": bl_to_gl(center), "restDeg": [0] * len(limits),
                    "group": "spine", "limits": limits})
    for s, (side, sign) in SIDES.items():
        d = L["legs"][s]
        lateral = LEFT * sign
        td = (d["knee"] - d["hip"]).normalized()
        sd = (d["ankle"] - d["knee"]).normalized()
        fd = (d["mtp"] - d["ankle"]).normalized()
        od = (d["tip"] - d["mtp"]).normalized()
        out += [
            {"id": f"hip_{side}", "bone": f"thigh_{s}", "side": side, "center": bl_to_gl(d["hip"]), "restDeg": [0, 0, 0], "group": "leg",
             "limits": [lim("x", *J["hip"]["flex"], td.cross(ANTERIOR).normalized(), "屈曲(+)/伸展(−)"),
                        lim("z", *J["hip"]["abd"], td.cross(lateral).normalized(), "外展(+)/內收(−)"),
                        lim("y", *J["hip"]["rot"], td * sign, "內旋(+)/外旋(−)")]},
            {"id": f"knee_{side}", "bone": f"shin_{s}", "side": side, "center": bl_to_gl(d["knee"]), "restDeg": [0], "group": "leg",
             "limits": [lim("x", *J["knee"]["flex"], sd.cross(-ANTERIOR).normalized(), "屈曲")]},
            {"id": f"ankle_{side}", "bone": f"foot_{s}", "side": side, "center": bl_to_gl(d["ankle"]), "restDeg": [0, 0], "group": "leg",
             "limits": [lim("x", *J["ankle"]["dorsi"], fd.cross(UP).normalized(), "背屈(+)/蹠屈(−)"),
                        lim("z", *J["ankle"]["inv"], -fd * sign, "內翻(+)/外翻(−)")]},
            {"id": f"toes_{side}", "bone": f"toes_{s}", "side": side, "center": bl_to_gl(d["mtp"]), "restDeg": [0], "group": "leg",
             "limits": [lim("x", *J["toes"]["ext"], od.cross(UP).normalized(), "伸展(+)/屈曲(−)")]},
        ]
    return out


# ------------------------------------------------------------------ static muscle weights
def _bone_kdtree():
    pts, wts = [], []
    for o in bpy.data.objects:
        if o.type != "MESH" or o.get("category") != "bone":
            continue
        names = [vg.name for vg in o.vertex_groups]
        for v in o.data.vertices:
            w = {names[gr.group]: gr.weight for gr in v.groups if gr.weight > 1e-4}
            if w:
                pts.append(v.co.copy())
                wts.append(w)
    kd = KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(p, i)
    kd.balance()
    print(f"BODY bone kd-tree: {len(pts)} 頂點")
    return kd, wts


def _top4(w):
    items = sorted(w.items(), key=lambda kv: -kv[1])[:4]
    tot = sum(v for _, v in items) or 1.0
    return {k: v / tot for k, v in items if v / tot > 1e-3}


def _bind_static(o, kd, wts, sigma=0.008, iters=4):
    W = []
    for v in o.data.vertices:
        hits = kd.find_n(v.co, 12)
        dmin = hits[0][2]
        acc = {}
        for _, i, dist in hits:
            k = math.exp(-(dist - dmin) / sigma)
            for b, w in wts[i].items():
                acc[b] = acc.get(b, 0.0) + k * w
        W.append(_top4(acc))
    nbr = [[] for _ in o.data.vertices]
    for e in o.data.edges:
        a, b = e.vertices
        nbr[a].append(b)
        nbr[b].append(a)
    for _ in range(iters):
        nw = []
        for i, w in enumerate(W):
            acc = dict(w)
            for j in nbr[i]:
                for k, val in W[j].items():
                    acc[k] = acc.get(k, 0.0) + val
            nw.append(_top4(acc))
        W = nw
    groups = {}
    for v, w in zip(o.data.vertices, W):
        for b, val in w.items():
            if b not in groups:
                groups[b] = o.vertex_groups.new(name=b)
            groups[b].add([v.index], val, "REPLACE")
    add_armature(o)
    return sorted(groups)


# ------------------------------------------------------------------ M4 dynamic muscles
def _bname(b, s):
    return b if (s is None or b in MID_BONES) else f"{b}_{s}"


def _jname(j, side):
    return j if (side == "midline" or j in MID_JOINTS) else f"{j}_{side}"


def _seg(name):
    b = arm_data.bones[name]
    return b.head_local.copy(), b.tail_local.copy()


def _dynamic(o, m, dyn, s, side, zh, L):
    """M4：把靜態肌群升級成動態肌肉——推算起止點、加 bulge/shorten/stretch shape keys，回傳 manifest 條目。
    主軸取網格主成分，方向由「哪一端離起點骨 / 止點骨較近」決定。附著點皆為 approximate。"""
    ob, ib = _bname(dyn["origin"], s), _bname(dyn["insertion"], s)
    _, axis = principal_axis(verts(o))
    e0, e1 = end_centroid(o, axis, "min", 0.03), end_centroid(o, axis, "max", 0.03)
    (oa, ot), (ia, it) = _seg(ob), _seg(ib)
    keep = seg_dist(e0, oa, ot) + seg_dist(e1, ia, it)
    flip = seg_dist(e1, oa, ot) + seg_dist(e0, ia, it)
    if flip < keep:
        axis, e0, e1 = -axis, e1, e0
    add_shape_keys(o, axis, *dyn.get("shape", [0.3, 0.12]))

    def lm_point(v):
        """地標點：關節中心 + 上下 / 前後偏移（公尺）。用於肌腱跨過關節後的附著（例：股四頭肌經髕骨止於脛骨粗隆）"""
        c = L["legs"][s][v["at"]] if v["at"] in ("hip", "knee", "ankle", "mtp") else L[v["at"]]
        side_dir = ANTERIOR if v.get("side", "anterior") == "anterior" else -ANTERIOR
        # medial：往身體中線偏移（公尺，M4.2 新增，預設 0 → 既有地標不變）
        medial_dir = -LEFT if s == "l" else LEFT
        return c + UP * v.get("up", 0.0) + side_dir * v.get("depth", 0.0) + medial_dir * v.get("medial", 0.0)

    if dyn.get("origin_pt"):
        e0 = lm_point(dyn["origin_pt"])
    if dyn.get("insertion_pt"):
        e1 = lm_point(dyn["insertion_pt"])
    via = [{"bone": _bname(v["bone"], s), "position": bl_to_gl(lm_point(v)), "confidence": "approximate"}
           for v in dyn.get("via", [])]
    name = o.name
    return {
        "id": name, "name": m["name"], "name_zh": zh + m["name_zh"], "name_latin": dyn.get("name_latin", ""),
        "side": side, "region": m["region"], "architecture": dyn.get("architecture", "fusiform"), "mesh": name,
        "origin": [{"bone": ob, "position": bl_to_gl(e0), "confidence": "approximate"}],
        "insertion": [{"bone": ib, "position": bl_to_gl(e1), "confidence": "approximate"}],
        "via_points": via,
        "joints_crossed": [_jname(j, side) for j in dyn["joints"]],
        "function": dyn.get("function", []), "innervation": dyn.get("innervation", ""),
        "activation": 0, "deformation_profile": "fusiform_v2",
        **({"deformation_params": dyn["deformation_params"]} if dyn.get("deformation_params") else {}),
        "morphs": {"bulge": "bulge", "shorten": "shorten", "stretch": "stretch"}, "source": SRC,
        **({"members": m["members"]} if m.get("members") else {}),
    }


# ------------------------------------------------------------------ build
def build(g, body, L, joints, structures):
    init(g)
    segs = _spine_segments(L)

    def spine_weights(p):
        ds = [(n, seg_dist(p, a, b)) for n, a, b in segs]
        dmin = min(d for _, d in ds)
        w = {n: math.exp(-(d - dmin) / 0.006) for n, d in ds if d - dmin < 0.03}
        tot = sum(w.values())
        return {n: v / tot for n, v in w.items()}

    # 骨骼
    for bd in body["bones"]:
        for s in ([None] if bd["side"] == "mid" else list(SIDES)):
            bone = bd["bone"] if s is None else f"{bd['bone']}_{s}"
            side = "midline" if s is None else SIDES[s][0]
            name = bd["id"] if s is None else f"{bd['id']}_{side}"
            if bd["id"] in SPINE_BONE_IDS:
                per = lambda o: _const_groups(o, spine_weights(centroid(verts(o))))
            else:
                per = lambda o, b=bone: _const_groups(o, {b: 1.0})
            o = _take(bd["parts"], s, name, bd.get("ratio", body.get("bone_ratio", 1.0)), per)
            if o is None:
                continue
            add_armature(o)
            finish(o, "bone")
            zh = "" if s is None else ("左側" if s == "l" else "右側")
            structures.append({"id": name, "name": bd["name"], "name_zh": zh + bd["name_zh"], "category": "bone", "side": side})

    joints += _joints(body, L)

    # 靜態肌肉（LBS 跟隨最近骨骼）
    kd, wts = _bone_kdtree()
    n_static = n_dyn = 0
    for m in body["muscles"]:
        for s in ([None] if m.get("side") == "mid" else list(SIDES)):
            side = "midline" if s is None else SIDES[s][0]
            name = m["id"] if s is None else f"{m['id']}_{side}"
            o = _take(m["parts"], s, name, m.get("ratio", body.get("muscle_ratio", 1.0)))
            if o is None:
                continue
            bones = _bind_static(o, kd, wts, sigma=m.get("sigma", body.get("sigma", 0.008)), iters=m.get("smooth", body.get("smooth", 4)))
            zh = "" if s is None else ("左側" if s == "l" else "右側")
            dyn = m.get("dynamic")
            if dyn:
                # M4：權重沿用 M3（最近骨骼表面），另加形變 shape keys 與起止點，交給前端 MuscleSystem 驅動
                g["muscles"].append(_dynamic(o, m, dyn, s, side, zh, L))
                finish(o, "muscle")
                n_dyn += 1
            else:
                finish(o, "muscle")
                o["static"] = True
                n_static += 1
            structures.append({"id": name, "name": m["name"], "name_zh": zh + m["name_zh"], "category": "muscle", "side": side,
                               "region": m["region"], "static": not dyn, "bound": True, "bones": bones})
    print(f"BODY 靜態肌肉 {n_static} 個、動態肌肉 {n_dyn} 個")
    return n_static
