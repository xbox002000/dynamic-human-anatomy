# Source / License Inventory v0.2

> 已核對來源授權檔（2026-11-26）。本表不構成法律意見；正式商用前仍須再審。

## 1. 專案內資產

| 資產 | 路徑 | 來源 | 授權 | 備註 |
| --- | --- | --- | --- | --- |
| Z-Anatomy 左上肢 Rig | `apps/web/public/models/arm_zanatomy_l.glb` | Z-Anatomy 幾何（經 anatomy-explorer 轉檔），DHA 加骨架/權重/shape keys | **CC BY-SA 4.0**（ShareAlike 繼承） | 骨：humerus/radius/ulna；肌：biceps（長+短頭合併）、brachialis、triceps（三頭合併） |
| Z-Anatomy 左上肢 manifest | `apps/web/public/data/arm_zanatomy_manifest.json` | 由 `build_arm_zanatomy.py` 從網格端點推算 | CC BY-SA 4.0 | 關節中心、軸向、附著點皆為 `approximate` |
| Z-Anatomy 雙側上肢 Rig | `apps/web/public/models/upper_limbs.glb` | Z-Anatomy 幾何（經 anatomy-explorer 轉檔），DHA 加骨架（含手指）/權重/`bulge`·`shorten`·`stretch` shape keys | **CC BY-SA 4.0**（ShareAlike 繼承） | 每側：鎖骨、肩胛、肱骨、橈骨、尺骨、手部骨骼；15 組肌肉（含握力肌群） |
| Z-Anatomy 雙側上肢 manifest | `apps/web/public/data/upper_limbs_manifest.json` | 由 `build_upper_limbs.py` 從網格推算 | CC BY-SA 4.0 | 關節中心/軸向、附著點、握把幾何皆為 `approximate` |
| 情境動作 | `apps/web/public/data/motions/**` | DHA 撰寫 | CC BY-SA 4.0 | 啟動曲線為教科書近似，非 EMG |
| 程序化手臂樣本 | `apps/web/public/models/arm_sample.glb`、`arm_manifest.json` | 本專案腳本產生 | project-internal | placeholder，僅供管線測試（`?model=sample`） |
| 專案程式碼 | `apps/`、`packages/`、`tools/`、`tests/` | 本專案 | **MIT** | 與資產授權分離 |

## 2. 外部來源（已核對）

| 來源 | 授權 | 依據 | 對本專案的影響 |
| --- | --- | --- | --- |
| Z-Anatomy Models-of-human-anatomy | CC BY-SA 4.0 | repo `License.txt` | 衍生 GLB 必須以 CC BY-SA 4.0 釋出並標示出處 |
| └ BodyParts3D（DBCLS） | CC BY-SA 2.1 JP | 同上 Attributions | 必須同時標示 |
| └ Cranial Nerves and Foramina（Dundee） | CC BY 4.0 | 同上 | 目前未使用 |
| └ **Anatomy of the Inner Ear（Dundee）** | **CC BY-NC-SA 4.0** | 同上 | **非商用**：不得進入商用 build |
| └ **Kidney（Lissie Cowley）** | **CC BY-NC 4.0** | 同上 | **非商用**：不得進入商用 build |
| └ Brainder / White matter（U. Washington） | 未載明 | 同上 | 使用前需確認 |
| └ 定義文字（Wikipedia） | CC BY-SA 3.0 | 同上 | 若引用定義文字須標示 |
| anatomy-explorer（ArianArsenal） | **程式碼無 LICENSE**（GitHub API `license: null`） | repo 根目錄 | 程式碼**不可複製**，只作研究參考；其 `public/models/*.glb` 依 CREDITS.md 為 CC BY-SA 4.0 的 Z-Anatomy 衍生物，可使用 |
| BodyExplorer | 未核對 | — | 尚未使用 |
| OpenSim 模型 | 依模型而異 | — | 尚未使用 |

## 3. 規則

1. 動態 Rig 只使用 Z-Anatomy 主體（BodyParts3D 衍生）幾何；上肢肌肉骨骼不涉及 NC 來源。
2. 匯入新結構時，先比對 §2 NC 清單（內耳、腎臟）——若需要，放在獨立 GLB 並標示 `license: CC-BY-NC-*`，商用 build 排除。
3. 每個 manifest 肌肉都帶 `source.license` 與 `source.attribution`；UI 資訊面板會顯示。
4. 原始下載放 `assets/source/`（gitignore，不入版控），可用 `pnpm model:zanatomy:fetch` 重建。
5. 不從 anatomy-explorer 複製程式碼；`tools/model_optimizer/extract-parts.mjs` 為本專案自寫。

## 4. 公開發佈檢查清單（決策：完全公開）

- [x] 上肢 Rig 每個 mesh 可追溯到單一授權（CC BY-SA 4.0 / BodyParts3D）
- [x] 專案程式碼授權：MIT（`LICENSE`）
- [x] 模型與解剖資料授權：CC BY-SA 4.0（`LICENSE-ASSETS.md`）
- [x] `assets/licenses/` 收錄 CC BY-SA 4.0、CC BY-SA 2.1 JP、Z-Anatomy License、anatomy-explorer CREDITS
- [x] UI 內提供出處（資訊面板 + 「關於 / 授權」）
- [x] 禁止引入 NC 子來源（內耳、腎臟）——與「完全公開、不限用途」立場衝突
