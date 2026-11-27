# 肌肉清單（自動產生）

> 由 `tools/validators/muscle-inventory.mjs` 從 `apps/web/public/data/full_body_manifest.json` 與 `apps/web/public/models/full_body.glb` 產生，請勿手動編輯。
> 所有附著點、經過點與關節範圍都是估計值（confidence 欄），不代表解剖或生理上的精確數據。

## 摘要

| 項目 | 數量 |
|---|---|
| manifest 動態 MuscleDefinition | 54 |
| ├ 上肢動態（upper_arm / forearm / elbow / hand） | 30 |
| └ 軀幹與下肢動態 | 24 |
| 軀幹與下肢肌群 structures（category = muscle） | 80 |
| ├ 已升級為動態（static: false） | 24 |
| └ 靜態（只跟隨骨架做 LBS，沒有 morph） | 56 |
| 關節 | 49 |
| 握持定義 | 2 |

- 動態肌肉的 architecture 分佈：bipennate 4、flat 18、fusiform 14、multihead 10、multipennate 2、pennate 6
- 動態肌肉的 deformation_profile 分佈：fusiform_v2 54
- 附著點 confidence 分佈：approximate 136
- 一致性檢查：通過（每條動態肌肉的 mesh 有 skin、三個 morph 都在、路徑骨骼與跨越關節都存在）

## 動態肌肉（54）

| id | 區域 | architecture | profile | 跨越關節 | 路徑骨骼（起點 → 經過點 → 止點） | 附著點 confidence | GLB morph targets | skinned |
|---|---|---|---|---|---|---|---|---|
| biceps_brachii_left | upper_arm | fusiform | fusiform_v2 | shoulder_left, elbow_left | shoulder_l → upper_arm_l → forearm_l | approximate×3 | bulge, shorten, stretch | yes |
| brachialis_left | upper_arm | fusiform | fusiform_v2 | elbow_left | upper_arm_l → upper_arm_l → forearm_l | approximate×3 | bulge, shorten, stretch | yes |
| triceps_brachii_left | upper_arm | multihead | fusiform_v2 | shoulder_left, elbow_left | shoulder_l → upper_arm_l → forearm_l | approximate×3 | bulge, shorten, stretch | yes |
| brachioradialis_left | forearm | fusiform | fusiform_v2 | elbow_left | upper_arm_l → forearm_l → forearm_l | approximate×3 | bulge, shorten, stretch | yes |
| pronator_teres_left | forearm | fusiform | fusiform_v2 | elbow_left | upper_arm_l → forearm_l | approximate×2 | bulge, shorten, stretch | yes |
| wrist_flexors_left | forearm | pennate | fusiform_v2 | elbow_left, wrist_left | upper_arm_l → forearm_l → hand_l | approximate×3 | bulge, shorten, stretch | yes |
| finger_flexors_left | forearm | pennate | fusiform_v2 | elbow_left, wrist_left, middle_mcp_left, middle_pip_left, middle_dip_left | upper_arm_l → forearm_l → middle_dist_l | approximate×3 | bulge, shorten, stretch | yes |
| forearm_extensors_left | forearm | pennate | fusiform_v2 | elbow_left, wrist_left | upper_arm_l → forearm_l → hand_l | approximate×3 | bulge, shorten, stretch | yes |
| supinator_left | forearm | flat | fusiform_v2 | elbow_left | upper_arm_l → forearm_l | approximate×2 | bulge, shorten, stretch | yes |
| anconeus_left | elbow | flat | fusiform_v2 | elbow_left | upper_arm_l → forearm_l | approximate×2 | bulge, shorten, stretch | yes |
| thenar_muscles_left | hand | flat | fusiform_v2 | thumb_cmc_left, thumb_mcp_left | hand_l → thumb_prox_l | approximate×2 | bulge, shorten, stretch | yes |
| adductor_pollicis_left | hand | flat | fusiform_v2 | thumb_cmc_left, thumb_mcp_left | hand_l → thumb_prox_l | approximate×2 | bulge, shorten, stretch | yes |
| hypothenar_muscles_left | hand | flat | fusiform_v2 | little_mcp_left | hand_l → little_prox_l | approximate×2 | bulge, shorten, stretch | yes |
| lumbricals_left | hand | fusiform | fusiform_v2 | middle_mcp_left, middle_pip_left | hand_l → middle_prox_l | approximate×2 | bulge, shorten, stretch | yes |
| interossei_left | hand | bipennate | fusiform_v2 | middle_mcp_left | hand_l → middle_prox_l | approximate×2 | bulge, shorten, stretch | yes |
| biceps_brachii_right | upper_arm | fusiform | fusiform_v2 | shoulder_right, elbow_right | shoulder_r → upper_arm_r → forearm_r | approximate×3 | bulge, shorten, stretch | yes |
| brachialis_right | upper_arm | fusiform | fusiform_v2 | elbow_right | upper_arm_r → upper_arm_r → forearm_r | approximate×3 | bulge, shorten, stretch | yes |
| triceps_brachii_right | upper_arm | multihead | fusiform_v2 | shoulder_right, elbow_right | shoulder_r → upper_arm_r → forearm_r | approximate×3 | bulge, shorten, stretch | yes |
| brachioradialis_right | forearm | fusiform | fusiform_v2 | elbow_right | upper_arm_r → forearm_r → forearm_r | approximate×3 | bulge, shorten, stretch | yes |
| pronator_teres_right | forearm | fusiform | fusiform_v2 | elbow_right | upper_arm_r → forearm_r | approximate×2 | bulge, shorten, stretch | yes |
| wrist_flexors_right | forearm | pennate | fusiform_v2 | elbow_right, wrist_right | upper_arm_r → forearm_r → hand_r | approximate×3 | bulge, shorten, stretch | yes |
| finger_flexors_right | forearm | pennate | fusiform_v2 | elbow_right, wrist_right, middle_mcp_right, middle_pip_right, middle_dip_right | upper_arm_r → forearm_r → middle_dist_r | approximate×3 | bulge, shorten, stretch | yes |
| forearm_extensors_right | forearm | pennate | fusiform_v2 | elbow_right, wrist_right | upper_arm_r → forearm_r → hand_r | approximate×3 | bulge, shorten, stretch | yes |
| supinator_right | forearm | flat | fusiform_v2 | elbow_right | upper_arm_r → forearm_r | approximate×2 | bulge, shorten, stretch | yes |
| anconeus_right | elbow | flat | fusiform_v2 | elbow_right | upper_arm_r → forearm_r | approximate×2 | bulge, shorten, stretch | yes |
| thenar_muscles_right | hand | flat | fusiform_v2 | thumb_cmc_right, thumb_mcp_right | hand_r → thumb_prox_r | approximate×2 | bulge, shorten, stretch | yes |
| adductor_pollicis_right | hand | flat | fusiform_v2 | thumb_cmc_right, thumb_mcp_right | hand_r → thumb_prox_r | approximate×2 | bulge, shorten, stretch | yes |
| hypothenar_muscles_right | hand | flat | fusiform_v2 | little_mcp_right | hand_r → little_prox_r | approximate×2 | bulge, shorten, stretch | yes |
| lumbricals_right | hand | fusiform | fusiform_v2 | middle_mcp_right, middle_pip_right | hand_r → middle_prox_r | approximate×2 | bulge, shorten, stretch | yes |
| interossei_right | hand | bipennate | fusiform_v2 | middle_mcp_right | hand_r → middle_prox_r | approximate×2 | bulge, shorten, stretch | yes |
| gluteus_maximus_left | hip | flat | fusiform_v2 | hip_left | pelvis → pelvis → thigh_l | approximate×3 | bulge, shorten, stretch | yes |
| gluteus_maximus_right | hip | flat | fusiform_v2 | hip_right | pelvis → pelvis → thigh_r | approximate×3 | bulge, shorten, stretch | yes |
| gluteus_medius_minimus_left | hip | flat | fusiform_v2 | hip_left | pelvis → thigh_l | approximate×2 | bulge, shorten, stretch | yes |
| gluteus_medius_minimus_right | hip | flat | fusiform_v2 | hip_right | pelvis → thigh_r | approximate×2 | bulge, shorten, stretch | yes |
| iliopsoas_left | hip | fusiform | fusiform_v2 | lumbar, hip_left | lumbar → pelvis → thigh_l | approximate×3 | bulge, shorten, stretch | yes |
| iliopsoas_right | hip | fusiform | fusiform_v2 | lumbar, hip_right | lumbar → pelvis → thigh_r | approximate×3 | bulge, shorten, stretch | yes |
| quadriceps_left | thigh | multihead | fusiform_v2 | hip_left, knee_left | thigh_l → thigh_l → shin_l | approximate×3 | bulge, shorten, stretch | yes |
| quadriceps_right | thigh | multihead | fusiform_v2 | hip_right, knee_right | thigh_r → thigh_r → shin_r | approximate×3 | bulge, shorten, stretch | yes |
| hamstrings_left | thigh | multihead | fusiform_v2 | hip_left, knee_left | pelvis → thigh_l → shin_l | approximate×3 | bulge, shorten, stretch | yes |
| hamstrings_right | thigh | multihead | fusiform_v2 | hip_right, knee_right | pelvis → thigh_r → shin_r | approximate×3 | bulge, shorten, stretch | yes |
| adductors_left | thigh | multihead | fusiform_v2 | hip_left | pelvis → thigh_l | approximate×2 | bulge, shorten, stretch | yes |
| adductors_right | thigh | multihead | fusiform_v2 | hip_right | pelvis → thigh_r | approximate×2 | bulge, shorten, stretch | yes |
| gastrocnemius_left | leg | bipennate | fusiform_v2 | knee_left, ankle_left | thigh_l → foot_l | approximate×2 | bulge, shorten, stretch | yes |
| gastrocnemius_right | leg | bipennate | fusiform_v2 | knee_right, ankle_right | thigh_r → foot_r | approximate×2 | bulge, shorten, stretch | yes |
| soleus_left | leg | multipennate | fusiform_v2 | ankle_left | shin_l → foot_l | approximate×2 | bulge, shorten, stretch | yes |
| soleus_right | leg | multipennate | fusiform_v2 | ankle_right | shin_r → foot_r | approximate×2 | bulge, shorten, stretch | yes |
| tibialis_anterior_left | leg | fusiform | fusiform_v2 | ankle_left | shin_l → shin_l → foot_l | approximate×3 | bulge, shorten, stretch | yes |
| tibialis_anterior_right | leg | fusiform | fusiform_v2 | ankle_right | shin_r → shin_r → foot_r | approximate×3 | bulge, shorten, stretch | yes |
| rectus_abdominis_left | abdomen | flat | fusiform_v2 | lumbar, thoracic | pelvis → chest | approximate×2 | bulge, shorten, stretch | yes |
| rectus_abdominis_right | abdomen | flat | fusiform_v2 | lumbar, thoracic | pelvis → chest | approximate×2 | bulge, shorten, stretch | yes |
| abdominal_obliques_left | abdomen | flat | fusiform_v2 | lumbar, thoracic | pelvis → chest | approximate×2 | bulge, shorten, stretch | yes |
| abdominal_obliques_right | abdomen | flat | fusiform_v2 | lumbar, thoracic | pelvis → chest | approximate×2 | bulge, shorten, stretch | yes |
| erector_spinae_left | back | multihead | fusiform_v2 | lumbar, thoracic | pelvis → lumbar → chest → chest | approximate×4 | bulge, shorten, stretch | yes |
| erector_spinae_right | back | multihead | fusiform_v2 | lumbar, thoracic | pelvis → lumbar → chest → chest | approximate×4 | bulge, shorten, stretch | yes |

## 靜態肌群（56）

| id | 中文名 | 區域 | 綁定骨骼 |
|---|---|---|---|
| tensor_fasciae_latae_left | 左側闊筋膜張肌與髂脛束 | hip | pelvis, shin_l, thigh_l |
| tensor_fasciae_latae_right | 右側闊筋膜張肌與髂脛束 | hip | pelvis, shin_r, thigh_r |
| deep_hip_rotators_left | 左側深層髖外旋肌群 | hip | pelvis, thigh_l |
| deep_hip_rotators_right | 右側深層髖外旋肌群 | hip | pelvis, thigh_r |
| sartorius_left | 左側縫匠肌 | thigh | pelvis, shin_l, thigh_l |
| sartorius_right | 右側縫匠肌 | thigh | pelvis, shin_r, thigh_r |
| toe_extensors_left | 左側伸趾長肌群 | leg | foot_l, shin_l, toes_l |
| toe_extensors_right | 右側伸趾長肌群 | leg | foot_r, shin_r, toes_r |
| fibularis_left | 左側腓骨肌群 | leg | foot_l, shin_l |
| fibularis_right | 右側腓骨肌群 | leg | foot_r, shin_r |
| deep_posterior_leg_left | 左側小腿深層後側肌群 | leg | foot_l, shin_l, thigh_l, toes_l |
| deep_posterior_leg_right | 右側小腿深層後側肌群 | leg | foot_r, shin_r, thigh_r, toes_r |
| foot_intrinsics_left | 左側足內在肌群 | foot | foot_l, toes_l |
| foot_intrinsics_right | 右側足內在肌群 | foot | foot_r, toes_r |
| transversus_abdominis_left | 左側腹橫肌 | abdomen | chest, lumbar, pelvis |
| transversus_abdominis_right | 右側腹橫肌 | abdomen | chest, lumbar, pelvis |
| quadratus_lumborum_left | 左側腰方肌 | back | chest, lumbar, pelvis |
| quadratus_lumborum_right | 右側腰方肌 | back | chest, lumbar, pelvis |
| transversospinales_left | 左側橫突棘肌群（多裂肌、半棘肌等） | back | chest, head, lumbar, neck, pelvis |
| transversospinales_right | 右側橫突棘肌群（多裂肌、半棘肌等） | back | chest, head, lumbar, neck, pelvis |
| latissimus_dorsi_left | 左側闊背肌 | back | chest, lumbar, pelvis, shoulder_l, upper_arm_l |
| latissimus_dorsi_right | 右側闊背肌 | back | chest, lumbar, pelvis, shoulder_r, upper_arm_r |
| trapezius_left | 左側斜方肌 | back | chest, head, lumbar, neck, shoulder_l |
| trapezius_right | 右側斜方肌 | back | chest, head, lumbar, neck, shoulder_r |
| rhomboids_left | 左側菱形肌 | back | chest, neck, shoulder_l |
| rhomboids_right | 右側菱形肌 | back | chest, neck, shoulder_r |
| levator_scapulae_left | 左側提肩胛肌 | neck | chest, head, neck, shoulder_l |
| levator_scapulae_right | 右側提肩胛肌 | neck | chest, head, neck, shoulder_r |
| serratus_anterior_left | 左側前鋸肌 | thorax | chest, shoulder_l |
| serratus_anterior_right | 右側前鋸肌 | thorax | chest, shoulder_r |
| serratus_posterior_left | 左側後鋸肌 | back | chest, lumbar, neck, shoulder_l |
| serratus_posterior_right | 右側後鋸肌 | back | chest, lumbar, neck, shoulder_r |
| pectoralis_major_left | 左側胸大肌 | thorax | chest, shoulder_l, upper_arm_l |
| pectoralis_major_right | 右側胸大肌 | thorax | chest, shoulder_r, upper_arm_r |
| pectoralis_minor_left | 左側胸小肌與鎖骨下肌 | thorax | chest, shoulder_l |
| pectoralis_minor_right | 右側胸小肌與鎖骨下肌 | thorax | chest, shoulder_r |
| intercostals_left | 左側肋間肌群 | thorax | chest, lumbar, neck, shoulder_l |
| intercostals_right | 右側肋間肌群 | thorax | chest, lumbar, neck, shoulder_r |
| deltoid_left | 左側三角肌 | shoulder | chest, shoulder_l, upper_arm_l |
| deltoid_right | 右側三角肌 | shoulder | chest, shoulder_r, upper_arm_r |
| rotator_cuff_left | 左側旋轉肌袖 | shoulder | chest, shoulder_l, upper_arm_l |
| rotator_cuff_right | 右側旋轉肌袖 | shoulder | chest, shoulder_r, upper_arm_r |
| teres_major_left | 左側大圓肌 | shoulder | chest, shoulder_l, upper_arm_l |
| teres_major_right | 右側大圓肌 | shoulder | chest, shoulder_r, upper_arm_r |
| coracobrachialis_left | 左側喙肱肌 | shoulder | chest, shoulder_l, upper_arm_l |
| coracobrachialis_right | 右側喙肱肌 | shoulder | chest, shoulder_r, upper_arm_r |
| sternocleidomastoid_left | 左側胸鎖乳突肌 | neck | chest, head, neck, shoulder_l |
| sternocleidomastoid_right | 右側胸鎖乳突肌 | neck | chest, head, neck, shoulder_r |
| splenius_left | 左側夾肌 | neck | chest, head, neck |
| splenius_right | 右側夾肌 | neck | chest, head, neck |
| scalenes_left | 左側斜角肌群 | neck | chest, head, neck |
| scalenes_right | 右側斜角肌群 | neck | chest, head, neck |
| deep_neck_left | 左側頸深層肌群（椎前、枕下） | neck | chest, head, neck |
| deep_neck_right | 右側頸深層肌群（椎前、枕下） | neck | chest, head, neck |
| pelvic_floor | 骨盆底肌群 | pelvis | pelvis |
| diaphragm | 橫膈膜 | thorax | chest, lumbar |

## 腳掌著地（FootPlant）接觸約束

腳掌著地不是存在 manifest 裡的資料，而是 `apps/web/src/skeleton/FootPlant.ts` 在載入時從 rest pose 的足部骨骼網格推算的：

| 腳 | 接觸點 | 綁定骨骼 | 推算方式 |
|---|---|---|---|
| 左 / 右 | heel（腳跟） | foot_l / foot_r | `foot_skeleton_*` 底面 1.5 cm 內最後方的最低點 |
| 左 / 右 | ball（蹠骨頭下方） | foot_l / foot_r | 同一底面最前方的最低點 |
| 左 / 右 | toe（趾尖） | toes_l / toes_r | `toe_bones_*` 最前方的頂點 |

- 地面高度 = rest pose 所有接觸點中最低的 y。
- 這是 **root translation**（只平移骨盆）的著地，不是多關節足部 IK：不會改任何關節角度，所以當姿勢讓兩腳在水平方向互相分開（例如髖外展）時，雙腳模式只能讓兩腳中點不動，各腳仍會滑動。
