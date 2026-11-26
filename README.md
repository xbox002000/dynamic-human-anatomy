# Dynamic Human Anatomy Engine

[![CI](https://github.com/xbox002000/dynamic-human-anatomy/actions/workflows/ci.yml/badge.svg)](https://github.com/xbox002000/dynamic-human-anatomy/actions/workflows/ci.yml)

Web-based 3D 人體解剖與動態肌肉形變引擎（Three.js + TypeScript + React + Blender + GLB）。

目前階段：**M3 全身骨架**。預設模型為 Z-Anatomy 全身（`full_body.glb`）：骨盆為根、脊柱（腰 / 胸 / 頸 / 頭）、雙下肢（髖 / 膝 / 踝 / 趾）可 FK 擺姿；雙側上肢沿用 M2.6 的動態肌肉（形變、握持、雙側 IK）；軀幹與下肢 80 組肌肉先做靜態跟隨（LBS，尚無形變）。舊的上肢模型可用 `?model=upper` 開啟。下一步是 M4 全身主要肌群形變（見 [roadmap](docs/architecture/roadmap.md)）。

## 需求

- Node 22+
- pnpm 10（`corepack install -g pnpm@10.20.0`；Windows shim 位於 `%LOCALAPPDATA%\corepack-bin`）
- Blender 5.2（只有重建模型時需要；預設 `G:\Program Files\Blender Foundation\Blender 5.2\blender.exe`，可用環境變數 `BLENDER_EXE` 覆寫）

## 指令

```bash
pnpm install
pnpm dev                 # http://localhost:5173
pnpm typecheck
pnpm test                # 單元測試 + 真實 GLB 測試（upper_limbs.glb、full_body.glb）
pnpm build

# 模型管線（需 Blender）
pnpm model:zanatomy:fetch   # 下載 anatomy-explorer 的 Z-Anatomy GLB 到 assets/source/
pnpm model:upper            # 擷取雙側上肢 → Blender rig → upper_limbs.glb + manifest → 驗證
pnpm model:body             # M3 全身：上肢 + 脊柱/骨盆/下肢骨架 + 軀幹與下肢靜態肌肉 → full_body.glb
```

GitHub Actions（`.github/workflows/ci.yml`）每次 push / PR 都會跑 typecheck、測試、GLB 驗證與 build。

## 結構

```
apps/web/src/
  core/        SceneManager、AnatomyEngine（UI 唯一入口）
  skeleton/    PoseController（FK + 關節限制）、IKController（DLS，雙側）、GripController（握持）
  muscles/     MuscleSystem（Registry + 路徑長度 + Morph Driver）、muscleMath（deformation profile）
  animation/   motionSampler（情境動作取樣）
  state/       預設姿勢、姿勢儲存
  ui/          React 面板
apps/web/public/models|data   GLB、manifest、動作片段
packages/anatomy-schema       共用型別、JSON Schema、驗證
tools/blender                 Blender 製作管線腳本
tools/pipeline                上肢擷取 + rig 一鍵管線
tools/validators              GLB 檢查
tests/unit                    單元測試與真實 GLB 測試
docs/                         座標規範、授權盤點、路線圖
```

## 資料流

`Pose（關節角度）→ 骨骼 → 肌肉路徑長度 → deformation profile + Activation → morphTargetInfluences`

Pose 與 Activation 是兩個獨立輸入（藍圖 §1.2）。M2.6 起每條肌肉有三個 morph：

| Morph | 驅動來源 |
| --- | --- |
| `shorten`（縱向縮短） | 只由路徑長度（Pose）決定 |
| `bulge`（徑向隆起） | 幾何縮短 + Activation |
| `stretch`（拉長變細） | 路徑長度，Activation 會抵銷一部分 |

因此等長收縮（長度不變、Activation 高）時肌肉只會變飽滿，不會變短。

握持的接觸狀態一律依目前實際手指姿勢量測（握把表面間隙 ≤ 2 mm 視為接觸），手指被滑桿或動作改動後顯示會跟著變。

## 授權（完全公開）

- 程式碼：**MIT**，見 [LICENSE](LICENSE)
- 3D 模型、解剖資料與動作片段：**CC BY-SA 4.0**，見 [LICENSE-ASSETS.md](LICENSE-ASSETS.md)，逐檔出處見 [ATTRIBUTION.md](apps/web/public/models/ATTRIBUTION.md)
  - 幾何來自 [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy)（CC BY-SA 4.0），衍生自 BodyParts3D © DBCLS（CC BY-SA 2.1 JP），經 [anatomy-explorer](https://github.com/ArianArsenal/anatomy-explorer) 轉為 GLB
- 授權盤點與禁用來源：[docs/anatomy/source-license-inventory.md](docs/anatomy/source-license-inventory.md)

## 免責聲明

本專案用於教學與視覺化。附著點、關節中心、握把幾何與活動範圍為由模型推算或教科書近似值；肌肉啟動與形變為視覺模型，肘力矩為只算啞鈴重量的靜力近似，**不代表真實生理或臨床數據**。
