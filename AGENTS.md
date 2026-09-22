# Working rules for this project

Read `README.md` first — it is the full brief, and it is short.

1. **Measure before you claim.** Every fix here is verified against a measured
   output or it is not a fix. `python wall_motion.py <clip>` for one finished
   wall; `rigspec.compare()` for the verdict. Quote the number.
2. **Never name the camera body in a prompt.** Describe what happens to the
   picture. Every direction failure in this project came from breaking that
   rule with different words — see README §4.
3. **Keep the contract under about 3 KB.** It was 9.5 KB and the terms that
   mattered were ignored. Operator-facing rules go in the inspector, not the
   prompt.
4. **`hf generate cost` before spending.** Free, same validation as `create`.
5. **Set `TRIWALL_STATE` for any second instance.** A different port is not a
   different tool — both write the same `state.json`.
6. **Never run `/api/reset` or `/api/build-end-frame` against the live
   instance to test.** Both have silently destroyed or altered the owner's
   working scene.
7. `theatre.js` is the source of truth for geometry; `rigspec.js` for numbers.
   One place per fact.
