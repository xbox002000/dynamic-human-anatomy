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
