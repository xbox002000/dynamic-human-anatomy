# Asset License

This project is fully open. It uses two licenses:

| Scope | License |
| --- | --- |
| Source code: `apps/`, `packages/`, `tools/`, `tests/` (excluding model and data files listed below) | MIT (see `LICENSE`) |
| 3D models and anatomical data derived from Z-Anatomy / BodyParts3D: `apps/web/public/models/arm_zanatomy_*.glb`, `apps/web/public/data/arm_zanatomy_manifest.json`, `assets/**` | **CC BY-SA 4.0** |
| Procedural sample: `apps/web/public/models/arm_sample.glb`, `apps/web/public/data/arm_manifest.json` | CC BY-SA 4.0 (kept the same as the other assets for simplicity) |

## Attribution (required when redistributing models)

- Z-Anatomy – The libre 3D atlas of anatomy, CC BY-SA 4.0 — https://github.com/Z-Anatomy/Models-of-human-anatomy
- BodyParts3D, © The Database Center for Life Science, CC BY-SA 2.1 JP — https://dbarchive.biosciencedbc.jp/en/bodyparts3d/
- Rigging, shape keys and attachment estimates: Dynamic Human Anatomy Engine contributors, CC BY-SA 4.0

## Rules

- Derivatives of the models must stay under CC BY-SA 4.0 (ShareAlike).
- Never add Z-Anatomy sub-sources under NC licenses (Inner Ear – CC BY-NC-SA 4.0; Kidney – CC BY-NC 4.0). They conflict with the project's fully open, unrestricted-use position. See `docs/anatomy/source-license-inventory.md`.
- Full license texts are in `assets/licenses/`.
