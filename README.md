# Dynamic Human Anatomy Engine

Web-based 3D 人體解剖與動態肌肉形變引擎（Three.js + TypeScript + React + Blender + GLB）。

目前階段：**手臂技術垂直切片**（藍圖 Phase 3 的程序化原型）。幾何與附著點為 placeholder，非解剖參考數據。

## 需求

- Node 22+
- pnpm 10（`corepack install -g pnpm@10.20.0`；shim 位於 `%LOCALAPPDATA%\corepack-bin`）
- Blender 5.2（預設 `G:\Program Files\Blender Foundation\Blender 5.2\blender.exe`，可用環境變數 `BLENDER_EXE` 覆寫）

## 指令

```bash
pnpm install
pnpm model:arm      # Blender headless 產生 arm_sample.glb + .blend
pnpm validate:glb   # GLB 自動檢查（骨骼、權重、morph、manifest 交叉比對）
pnpm test           # 單元測試（肌肉長度、形變 profile、manifest）
pnpm typecheck
pnpm dev            # http://localhost:5173
```

## 結構

```
apps/web/src/
  core/        SceneManager、AnatomyEngine（UI 唯一入口）
  skeleton/    PoseController（FK + 關節限制）
  muscles/     MuscleSystem（Registry + 路徑長度 + Morph Driver）、muscleMath（profile）
  state/       預設姿勢、姿勢儲存
  ui/          React 面板
apps/web/public/models|data   GLB 與 manifest
packages/anatomy-schema       共用型別、JSON Schema、驗證
tools/blender                 Blender 製作管線腳本
tools/validators              GLB 檢查
docs/                         座標規範、授權盤點
```

## 資料流

`Pose（關節角度）→ 骨骼 → 肌肉路徑長度 → deformation profile + Activation → morphTargetInfluences`

Pose 與 Activation 是兩個獨立輸入（藍圖 §1.2）。

## 授權（完全公開）

- 程式碼：**MIT**，見 [LICENSE](LICENSE)
- 3D 模型與解剖資料：**CC BY-SA 4.0**，見 [LICENSE-ASSETS.md](LICENSE-ASSETS.md)
  - 幾何來自 [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy)（CC BY-SA 4.0），衍生自 BodyParts3D © DBCLS（CC BY-SA 2.1 JP）
- 授權盤點與禁用來源：[docs/anatomy/source-license-inventory.md](docs/anatomy/source-license-inventory.md)

## 免責聲明

本專案用於教學與視覺化。附著點、關節中心與活動範圍為由模型推算或教科書近似值；肌肉啟動與形變為視覺模型，**不代表真實生理或臨床數據**。
