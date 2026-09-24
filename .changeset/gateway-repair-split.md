---
"@usepolyglot/core": minor
---

Split `repairJson` into `repairJsonFastPath` (wrapper-strip + one `JSON.parse`) and
`repairJsonSlowPath` (`jsonrepair()` + regex fallbacks), both now exported alongside the
existing `repairJson` (unchanged behavior - it composes the two). Lets a caller under
concurrent load keep the cheap fast path inline and only dispatch the expensive slow path to
a worker thread. Also exports `resolveEnvelopeFromRepair` (same dispatch as `resolveEnvelope`,
taking an already-computed repair result) and adds an additive `strategy` field
(`"clean" | "wrapper_stripped" | "jsonrepair" | "loose_kv" | "trailing_blob"`) to
`RepairResult`'s `ok: true` branch, for repair-audit confidence tracking.
