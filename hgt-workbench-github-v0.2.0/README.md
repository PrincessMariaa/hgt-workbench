# HGT Workbench v0.2.0

Interactive exploratory model for SW620 Pgp WT → Pgp KO co-cultures. All starting biological probabilities, stress effects, and growth rates are assumptions; this app is not fitted to SW620 data.

## New in v0.2

- Separate productive acquisition, retained donor sequence, expression, and functional Pgp outcomes.
- Time-dependent donor and recipient growth, EV availability, stress windows, and survival. Post-exposure selection stays separate.
- Per-division retention; distinct reference and polyploid recipient classes. Fusion remains an alternative explanation, not a polyploidy mechanism.
- Independent baseline locks and permission for stress/ploidy modifiers.
- Observation ledger with CSV import/export, recipient and donor verification, inheritance and integration evidence, and alternative explanations.
- Conditional combined-rate estimation from matched independent starting-lineage counts. Phenotype-only and survivor-only counts are excluded. Individual gates are not identified by a final count.
- v0.1 scenario import with explicit retention and functional-assumption migration.

## Use

Serve this folder with a static server, or upload its contents to the root of a GitHub Pages repository. No build or dependencies are required. Data stay in the browser; export scenarios and observations to preserve them. Do not enter confidential identifiers into a public repository.

Run `node --test model.test.mjs` from this directory. The engine is in `engine.mjs`, state and migration in `model.mjs`, inference in `observations.mjs`, and evidence in `evidence.mjs`. The app's Model notes describe equations and limitations.

The time model is an event-time, rare-event lineage approximation, not a full branching simulation. Fits assume independent starting lineages and fixed exposure, survival, retention, and assay settings. Displayed uncertainty ranges reflect assumed parameter ranges, not experimental confidence intervals. Contact-dependent transfer is not assigned a quantitative pathway; the observation page makes the mechanism ambiguity explicit.

## GitHub Pages

Upload the extracted ZIP contents (including every .mjs and .css file) at the repository root. Set Settings → Pages → Deploy from a branch → main → /(root). The index must be at the root. Keep README and tests separately if desired.
