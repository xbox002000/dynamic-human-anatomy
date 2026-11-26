# Source / License Inventory（草稿 v0.1）

> 狀態：草稿。所有第三方授權條款須在**正式使用或發佈前**逐項重新核對原始授權檔，本表不構成法律意見。

## 1. 已納入專案的資產

| 資產 | 路徑 | 來源 | 授權 | 備註 |
| --- | --- | --- | --- | --- |
| 手臂程序化樣本 | `apps/web/public/models/arm_sample.glb`、`assets/working/arm_sample.blend` | 本專案 `tools/blender/build_arm_sample.py` 產生 | project-internal | 幾何與附著點皆為 placeholder，非解剖參考數據 |
| 手臂 manifest | `apps/web/public/data/arm_manifest.json` | 本專案手寫 | project-internal | 關節活動範圍、起止點皆標 `placeholder` / `approximate` |

## 2. 待評估的外部來源

| 來源 | 網址 | 預計用途 | 已知授權 | 待確認事項 |
| --- | --- | --- | --- | --- |
| Z-Anatomy | https://github.com/Z-Anatomy/Models-of-human-anatomy | 主要靜態解剖幾何、命名、分類 | 主體 CC BY-SA 4.0（ShareAlike） | 部分引用素材有不同條件，含 NC；需逐項列出衍生來源（如 BodyParts3D 等）；SA 對衍生 GLB 與網站散布的影響 |
| Anatomy Explorer | https://github.com/ArianArsenal/anatomy-explorer | 參考 Z-Anatomy 匯出流程、多層 GLB、選取與壓縮 | 待查 repo LICENSE | 程式碼能否直接引用；其匯出模型的授權繼承 |
| BodyExplorer | https://github.com/JohanBellander/BodyExplorer | 肌肉/骨骼對應、分組參考 | 待查 repo LICENSE | 同上 |
| OpenSim 模型 | https://opensim.stanford.edu/ | 肌肉路徑、長度、力學參數 | 依各模型而異（多為 Apache 2.0 或自訂） | 選定模型（例如上肢模型）後逐一確認 |

## 3. 每筆資產必須記錄的欄位

- `source.dataset`、`source.url`
- `source.license`（SPDX 識別碼為佳）
- `source.attribution`（顯示於 UI 的致謝文字）
- `source.derivedFrom`（原始來源 → 本專案衍生關係）
- 修改紀錄（由 `tools/blender/*` 腳本重建，避免手動改動被覆蓋）

## 4. 商用前檢查清單

- [ ] 每個 mesh 都能追溯到單一授權
- [ ] 沒有 NC 素材進入商用 build
- [ ] SA 素材的衍生物以相容授權釋出
- [ ] UI 內提供 attribution 頁面
- [ ] `assets/licenses/` 保存原始授權檔副本
