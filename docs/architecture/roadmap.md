# 最終願景與路線圖 v0.1

## 1. 最終目標（使用者定義）

一個**完整人體**的互動視覺化：

1. 預設顯示完整外觀（穿著衣物）。
2. 可切換顯示模式：**穿著** → **無穿著（皮膚）** → **肌肉** → **骨骼**，以及半透明疊加。
3. 可選體型：**男性 / 女性**（後續可加體型參數：身高、體脂、肌肉量）。
4. 情境動作：例如**舉啞鈴（二頭彎舉）**、**瑜珈伸展**，播放時肌肉隨動作縮短、拉長、隆起，並顯示主動肌 / 拮抗肌。

## 2. 架構對應

| 需求 | 對應模組 | 現況 |
| --- | --- | --- |
| 顯示模式切換 | AnatomyEngine 圖層（skin/muscle/bone）+ 新增 clothing 圖層 | skin/muscle/bone 已有；clothing 未做 |
| 完整人體骨架 | Deform Rig（藍圖 §5） | 完成（M3）：骨盆根、脊柱、雙上肢含手指、雙下肢，49 個關節 |
| 全身肌肉形變 | MuscleSystem + deformation profile | 54 條動態（上肢 30 + 軀幹下肢 24），另 56 組靜態只跟隨骨架；全部使用 `fusiform_v2`，見 [deformation-profiles.md](deformation-profiles.md) |
| 腳掌著地 | FootPlant（root translation） | 已實作；非多關節足部 IK |
| 情境動作 | MotionClip（anatomy-schema）+ 時間軸 + 每幀 activation 曲線 | 只有二頭彎舉；瑜珈動作未做 |
| 男 / 女體型 | 新增 BodyVariant：外層皮膚 + 衣物使用 shape keys / 不同網格，內部解剖共用並縮放 | 未做 |
| 衣物 | 綁在同一骨架上的 SkinnedMesh | 未做 |

## 3. 關鍵技術限制（必須先解決）

1. **Z-Anatomy 只有一個男性樣本**（BodyParts3D 源自單一男性）。沒有女性解剖幾何。
   - 方案：外觀層（皮膚、衣物）使用開放授權的參數化人體（候選：MakeHuman / MPFB2 資產，CC0），女性體型由外觀層表現；內部肌肉骨骼共用，依體型做比例縮放與局部 shape key。需在 UI 標示「女性內部解剖為由男性模型縮放的近似」。
2. **外觀皮膚與 Z-Anatomy 肌肉不是同一網格**，比例和姿勢不同。
   - 方案：建立「解剖對位」步驟：把外觀人體 fit 到 Z-Anatomy 皮膚的輪廓（或反向），兩者綁同一副 Deform Rig；皮膚加上由下方肌肉驅動的 corrective shape keys。
3. **Z-Anatomy 的 rest pose 是 A-pose/解剖姿勢**，衣物與外觀資產多為 T-pose 或 A-pose，需統一 rest pose（已在座標規範中指定，需改為與資產一致）。
4. **動作資料**：舉啞鈴、瑜珈先用手工關鍵影格（我們的 Pose JSON）；之後可匯入開放動作捕捉（候選：CMU Graphics Lab Motion Capture，可免費使用）並重定向到我們的骨架。
5. **肌肉啟動曲線**：每個動作附一份啟動時間曲線。先用文獻 / 教學描述的定性曲線（標記 `approximate`），之後可用 OpenSim 模擬結果替換。
6. **無穿著模式**（決策已定）：保留解剖正確的皮膚網格，但預設加上一件簡單的貼身內衣（`underwear` 圖層，綁同一骨架），使用者可手動關閉。整體預設仍為穿著模式。

## 4. 里程碑

| 階段 | 內容 | 驗收 |
| --- | --- | --- |
| M1（已完成） | 左上肢真實解剖 Rig、FK、IK、肌肉形變、姿勢儲存 | 10 測試通過 |
| M2 | 完整上肢（雙側）＋前臂主要肌群＋肩胛/鎖骨；**二頭彎舉動作**（啞鈴道具、啟動曲線） | 播放彎舉時二頭/肱肌隆起、三頭拉長 |
| M2.5 | 手指骨段/關節、握力肌群、握持求解、肘外力矩 | 雙手握住啞鈴，顯示接觸與力矩 |
| M2.6 | **雙側上肢穩定化**（不增加肌肉）：① Activation 不驅動縱向縮短（`bulge`/`shorten`/`stretch` 分離）② 握持接觸依實際手指姿勢量測 ③ 雙側 IK 獨立拖曳 ④ 真實 GLB 測試 ⑤ GitHub Actions ⑥ README/ATTRIBUTION/License 一致 | `pnpm test` 含真實 GLB 測試全過，CI 綠燈 |
| M3（已完成） | 全身骨架 Deform Rig（骨盆根、腰/胸/頸/頭、髖/膝/踝/趾）＋軀幹與下肢 80 組靜態肌肉（LBS，權重取自最近骨骼表面）；`full_body.glb` | 全身可擺姿；`fullBodyGlb.test.ts` 在 5 種大幅姿勢下量測 skinning 後肌肉到骨骼距離，p95 增量 ≤ 20 mm |
| M4（部分完成） | 軀幹與下肢 12 組（左右 24 條）動態肌肉（臀、髂腰、股四頭、膕旁、內收、小腿、脛前、腹、豎脊）＋腳掌著地（root translation）；**瑜珈伸展動作尚未做** | 膝 / 髖 / 軀幹前屈 / 深蹲的路徑長度方向測試通過 |
| M4.1（已完成） | 整合與驗證：由 manifest + GLB 產生肌肉清單；每條動態肌肉的 mesh / morph / 骨骼 / 長度 / activation 獨立性測試；更多下肢與軀幹動作方向測試；FootPlant 各模式測試；形變 profile 審查；文件同步。不新增肌肉、不重建模型 | `pnpm test`、typecheck、build、全部 GLB 驗證通過 |
| M4.2（本階段） | Visual QA：DEV-only QA Harness（`?qa=1`）＋ CDP runner（`pnpm qa:visual` / `qa:smoke`）＋ 8 組固定姿勢截圖；實際視覺檢查（[findings](../qa/m4.2-visual-findings.md)）；修正內收肌群起點、臀大肌形變範圍（`deformation_params`）；逐關節獨立測試、支撐點種類測試、IK + FootPlant 結合測試；CI 加入瀏覽器 smoke。不重建 GLB | 8 姿勢可重複截圖、94 tests、CI 綠燈 |
| M4.3（建議） | 依 M4.2 實際發現：股直肌獨立路徑（解除 quadriceps@hip 例外）、髖屈曲 corrective shape key（膕旁肌群起點端 LBS 剪切）、踮腳 preset（MTP 伸展）、腿部 IK 解決外展滑動 | 由 Visual QA 重拍對照 |
| M5 | 外觀層：皮膚＋**衣物**＋顯示模式切換（穿著 / 皮膚 / 肌肉 / 骨骼 / X-ray） | 同一動作下四種模式切換無錯位 |
| M6 | **男 / 女體型**選項（外觀層 shape keys＋內部比例縮放）＋體型參數 | 兩體型都能播放所有動作 |
| M7 | 動作庫擴充（mocap 重定向）、效能（LOD、分層載入）、行動裝置 | 60 FPS 桌面 / 30 FPS 行動 |

## 5. 現況與下一步（M4.2 之後）

M4.2 Visual QA 已確認並修正：內收肌群外展時幾乎不拉長（起點資料）、臀大肌 stretch 過早飽和（形變範圍）。已知但未修：膕旁肌群在髖屈曲 90° 起點端的 LBS 剪切（P2）、踮腳姿勢趾關節未伸展（P3）、側屈時手壓入大腿（P3，無碰撞）。逐關節測試保留 4 個有原因的例外（quadriceps@hip、lumbricals@PIP，左右各一）。詳見 [m4.2-visual-findings.md](../qa/m4.2-visual-findings.md)。

已完成：

1. 軀幹與下肢 24 條動態肌肉（`bulge` / `shorten` / `stretch` + 起止點 + 經過點，全部 `approximate`）。
2. 腳掌著地：FootPlant 以平移骨盆讓支撐腳貼地（雙腳 / 左 / 右 / 關閉）。這是 root translation，不是多關節足部 IK；雙髖外展等讓兩腳水平分開的姿勢，各腳會滑動（測試中已量化）。

尚未完成：

1. 瑜珈動作片段：下犬式、戰士二式，含啟動曲線。
2. 檔案大小：full_body.glb 約 14 MB，評估 meshopt 壓縮或分層載入。
3. 多頭肌（股四頭肌、肱三頭肌等）各頭獨立路徑，見 [deformation-profiles.md](deformation-profiles.md) 的 `multihead_v1` 草案。
4. 腿部 IK：讓雙腳在外展等姿勢下同時固定。
5. 外觀層（皮膚、衣物）與體型選項（M5、M6）。
