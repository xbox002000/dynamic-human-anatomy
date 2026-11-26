# 座標系統與命名規範 v0.1

## 1. 座標系

| 項目 | Blender（製作端） | glTF / Three.js（執行端） |
| --- | --- | --- |
| 上方 | +Z | +Y |
| 人體前方 (anterior) | -Y | +Z |
| 人體左側 | +X | +X |
| 單位 | 公尺 | 公尺 |
| 手性 | 右手 | 右手 |

- 匯出一律 `export_yup=True`，由 glTF 匯出器負責 Z-up → Y-up 轉換。
- 人體左側 = 世界 +X（人體面向觀察者 +Z 時，觀察者看到的右邊）。
- Rest Pose：T-pose，上肢沿 ±X 水平伸直，掌心朝下。

## 2. manifest 中的空間資料

- `origin` / `insertion` / `via_points` 的 `position`：**rest pose 的模型空間**（glTF 座標），執行期由 `MuscleSystem` 轉為所屬骨骼的局部座標，之後隨骨骼移動。
- `limits[].vector`：關節旋轉軸，rest pose 模型空間單位向量；正角度依右手定則繞此軸旋轉。由 `PoseController` 轉成骨骼局部軸。
  - 例：左肘屈曲 `vector = [0,-1,0]`，正角度使前臂往前（+Z）彎。

## 3. 命名

| 類型 | 規則 | 例 |
| --- | --- | --- |
| anatomicalId / mesh 名 | snake_case，完整英文名 + `_left` / `_right` | `biceps_brachii_left` |
| 骨骼（Deform Rig） | snake_case + `_l` / `_r` | `upper_arm_l` |
| 關節 ID | 解剖關節名 + `_left` / `_right` | `elbow_left` |
| Morph target | 與 profile 對應的固定名稱 | `contract`、`stretch` |

- GLB 中每個 mesh 節點帶 `extras.anatomicalId` 與 `extras.category`（`muscle` / `bone` / `skin`）。
- 靜態解剖資產與動態 Rig 以 anatomicalId 對應同一筆資料。

## 4. 資料可信度

`confidence`：`placeholder` → `approximate` → `literature` → `measured`。UI 必須顯示 confidence，不可把 placeholder 標為真實生理數值。
