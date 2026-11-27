# 肌肉形變 profile 審查（M4.1）

> 目的：評估目前 `fusiform_v2`（主軸 shape key）對不同肌肉結構是否足夠，並提出未來依結構分流的最小 API。
> 本文件不引入任何物理模擬；所有形變都是**視覺模型**，不代表真實肌纖維力學或生理數值。

## 1. 現況（由 manifest 實際統計，見 [muscle-inventory.md](../anatomy/muscle-inventory.md)）

- 54 條動態肌肉全部使用 `deformation_profile: fusiform_v2`。
- `architecture` 欄位已存在但**目前只是標籤，沒有影響形變**：fusiform 14、flat 18、multihead 10、pennate 6、bipennate 4、multipennate 2。
- 每條肌肉有三個 shape key，由 Blender 依網格主軸（PCA 第一主成分）產生：
  - `shorten`：沿主軸壓縮。
  - `bulge`：垂直主軸、以肌腹中段為峰值的徑向放大。
  - `stretch`：沿主軸拉長、徑向變細。
- 執行期 `fusiformV2(length, restLength, activation)` 只輸出三個 0..1 權重；路徑長度只決定 `shorten` / `stretch`，activation 只影響 `bulge`（並抵銷一部分 `stretch` 變細）。

## 2. 各結構的適用性

| 結構 | 代表肌肉（本專案） | 主軸 shape key 是否合理 | 主要問題 |
|---|---|---|---|
| fusiform（梭形） | 肱二頭肌、肱肌、髂腰肌、脛前肌 | **合理**，這是 profile 的設計前提 | 肌腱與肌腹同比例縮放，肌腱看起來也會變粗 |
| flat（扁平） | 臀大肌、腹直肌、腹斜肌、旋後肌、手內肌 | **部分合理** | 徑向放大是等向的；扁平肌應主要沿厚度方向增厚、寬度幾乎不變。腹斜肌纖維方向與 PCA 主軸不一致；臀大肌主軸不等於纖維方向 |
| pennate / bipennate（羽狀） | 前臂屈伸肌群、腓腸肌、骨間肌 | **勉強** | 羽狀肌收縮時纖維角度變大、整體長度變化比纖維小，且隆起偏向一側（單羽）或兩側（雙羽）。主軸等向隆起會高估長度變化帶來的外形改變 |
| multipennate（多羽） | 比目魚肌 | **勉強** | 同上；比目魚肌體積主要在後外側，徑向等向放大會讓前側也鼓起 |
| multihead（多頭） | 肱三頭肌、股四頭肌、膕旁肌、內收肌群、豎脊肌 | **不足** | 各頭跨越的關節不同（股直肌跨髖、三條股肌不跨；肱三頭肌長頭跨肩）。目前合併成一條路徑、一組 shape key，無法表現「其中一頭拉長、其他頭不變」。M4 股四頭肌路徑起點改到股骨，即為此限制的權宜做法 |

結論：目前不需要換掉 `fusiform_v2`，它對梭形肌是合理的，對其他結構是「可接受的近似」。最明顯的不足是 **multihead 共用單一路徑**，其次是 **flat 的等向隆起**。羽狀角度的變化屬於生理細節，暫不處理。

## 3. 最小 API 設計（尚未實作）

原則：

1. `fusiform_v2` 的輸入、輸出與名稱完全不變；舊 manifest 不改任何欄位仍可用。
2. 新 profile 只是 `DEFORMATION_PROFILES` 裡多一個名稱；找不到名稱時維持現在的行為（退回 fusiform）。
3. 新增的資料都是**可選欄位**，並且一律帶 `confidence: 'approximate'`。

### 3.1 profile 函式簽章（相容擴充）

```ts
// muscleMath.ts：DeformInput 加可選欄位，fusiformV2 忽略它們
export interface DeformInput {
  length: number;
  restLength: number;
  activation: number;
  maxShortening?: number;
  maxLengthening?: number;
  /** multihead：每個頭各自的路徑長度（與 heads 同順序），可選 */
  headLengths?: { length: number; restLength: number }[];
}

export interface DeformOutput {
  contraction: number; stretch: number; bulge: number;
  bulgeWeight: number; shortenWeight: number; stretchWeight: number;
  /** 額外的 morph 權重，key 為 MuscleDefinition.morphs 的額外欄位，可選 */
  extra?: Record<string, number>;
}
```

MuscleSystem 只需要多一個迴圈：若 `out.extra` 存在，依 `morphs[key]` 找 morph index 寫入。沒有 `extra` 時與現在完全相同。

### 3.2 manifest 可選欄位

```jsonc
{
  "deformation_profile": "flat_v1",          // 不寫或找不到 → fusiform_v2 行為
  "deformation_params": {                     // 可選
    "thickness_axis": [0, 0, 1],              // flat：增厚方向（模型空間），approximate
    "confidence": "approximate"
  },
  "heads": [                                  // 可選，multihead 用
    { "id": "rectus_femoris", "origin": [...], "via_points": [...], "insertion": [...], "morph": "bulge_rf" },
    { "id": "vasti",          "origin": [...], "via_points": [...], "insertion": [...], "morph": "bulge_vasti" }
  ],
  "morphs": { "bulge": "bulge", "shorten": "shorten", "stretch": "stretch", "bulge_rf": "bulge_rf", "bulge_vasti": "bulge_vasti" }
}
```

### 3.3 候選 profile（依優先順序）

| 名稱 | 新增 shape key | 行為 | 前置工作 |
|---|---|---|---|
| `multihead_v1` | 每頭一個 `bulge_<head>`（以該頭的頂點群組產生） | 整體 `shorten`/`stretch` 用主路徑；各頭的局部隆起與拉長由各自路徑長度決定 | Blender 端保留合併前各頭的頂點群組 |
| `flat_v1` | `thicken`（沿 thickness_axis） | `bulge` 權重改寫到 `thicken`，原 `bulge` 只給小比例 | 估計每塊扁平肌的厚度方向 |
| `pennate_v1` | 無新 shape key | 縮小 `shorten` 權重（乘上 cos 近似係數），隆起偏向一側時用 `deformation_params.bias_axis` | 先有視覺比較截圖再決定是否值得做 |

### 3.4 驗收方式（未來實作時）

- 既有測試不變：fusiform_v2 的所有 54 條肌肉行為與現在一致。
- multihead：股四頭肌在「只屈髖」時，股直肌頭拉長／縮短，股肌頭長度不變（差 < 1e-4）。
- 不加任何「力」「張力」等物理輸出；只驗證幾何與 morph 權重。
