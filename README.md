# Dynamic Human Anatomy Engine

[![CI](https://github.com/xbox002000/dynamic-human-anatomy/actions/workflows/ci.yml/badge.svg)](https://github.com/xbox002000/dynamic-human-anatomy/actions/workflows/ci.yml)

Web-based 3D 人體解剖與動態肌肉形變引擎（Three.js + TypeScript + React + Blender + GLB）。

目前階段：**M4.2 Visual QA**（實際畫面品質驗證與自動化）。預設模型為 Z-Anatomy 全身（`full_body.glb`），舊的上肢模型可用 `?model=upper` 開啟。

| 項目 | 狀態 |
| --- | --- |
| M3 全身骨架（骨盆根、腰 / 胸 / 頸 / 頭、髖 / 膝 / 踝 / 趾，FK 擺姿） | 完成 |
| 上肢動態肌肉（M2.6：形變、握持、雙側 IK） | 30 條 MuscleDefinition |
| 軀幹與下肢肌群 | 80 組：24 組動態（M4，含 `bulge` / `shorten` / `stretch`）、56 組靜態（只跟隨骨架做 LBS） |
| `full_body_manifest.json` 的動態 MuscleDefinition | 54 條（30 + 24） |
| 腳掌著地 FootPlant | 已實作，為 **root translation**（只平移骨盆），不是多關節足部 IK |
| 皮膚外觀層 / 衣物 | 未實作 |
| 瑜珈動作片段 | 未實作（目前只有二頭彎舉） |

逐條肌肉的清單（architecture、跨越關節、路徑骨骼、附著點 confidence、GLB morph targets）由實際 manifest 與 GLB 產生，見 [muscle-inventory.md](docs/anatomy/muscle-inventory.md)（`node tools/validators/muscle-inventory.mjs`）。形變 profile 的審查見 [deformation-profiles.md](docs/architecture/deformation-profiles.md)。下一步見 [roadmap](docs/architecture/roadmap.md)。

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
pnpm model:body             # 全身：上肢 + 脊柱/骨盆/下肢骨架 + 軀幹與下肢肌群（24 動態 / 56 靜態）→ full_body.glb

# 由 manifest + GLB 重新產生肌肉清單（--check：只檢查是否過期）
node tools/validators/muscle-inventory.mjs

# Visual QA（M4.2）：自動啟動 dev server、以 CDP 驅動 headless Edge / Chrome 套用固定姿勢並截圖
pnpm qa:visual           # 8 組姿勢（tools/dev/qa-poses.json）× 多視角 → artifacts/visual-qa/m4.2/（含 results.json）
pnpm qa:smoke            # CI 用：P01 / P03 / P05 正面，檢查載入、console error、姿勢套用、足部支撐
node tools/dev/visual-qa.mjs --only P03,P07 --out tmp/qa      # 只跑指定姿勢
node tools/dev/visual-qa.mjs --url http://localhost:5173      # 使用已啟動的 dev server
# 瀏覽器路徑可用環境變數 BROWSER 指定；結束碼 0 = 通過、1 = 檢查失敗、2 = 無法啟動 / 載入
```

GitHub Actions（`.github/workflows/ci.yml`）每次 push / PR 都會跑 typecheck、測試、GLB 驗證、build，以及瀏覽器 smoke QA（截圖以 artifact 上傳）。完整 8 姿勢的截圖判讀是本機流程，CI 不做像素比對。

QA Harness（`apps/web/src/dev/qaHarness.ts`）只在開發模式且網址帶 `?qa=1` 時載入，掛在 `window.__dhaQA`；production build 不包含。結果見 [m4.2-baseline.md](docs/qa/m4.2-baseline.md)、[m4.2-visual-findings.md](docs/qa/m4.2-visual-findings.md)。

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

腳掌著地（FootPlant）只平移骨盆，不調整任何關節角度。當姿勢讓兩腳在水平方向分開（例如雙側髖外展）時，雙腳模式只保證兩腳中點不動與最低支撐點貼地，各腳仍會滑動；要讓兩腳同時完全固定，需要之後的多關節腿部 IK。
