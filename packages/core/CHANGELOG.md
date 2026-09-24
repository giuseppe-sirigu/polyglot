# @usepolyglot/core

## 0.3.0

### Minor Changes

- Add the reliability digest report module (`generateReliabilityDigest`, `renderDigestMarkdown`,
  `buildRedactionPreview`, `repairRecordsFromAuditEvents`) and `readAuditEvents` for reading the
  local audit log back. Also adds a `strategy` field to `ParsedToolCall`/`AgentEvent`'s
  `tool_call` variant/`AuditEvent`'s `tool_call` variant (which repair path resolved a call,
  including "clean" for a non-repaired one) - previously only tracked internally by
  `repairJson`, now threaded through to the audit log so the digest can break down repairs by
  strategy, not just by model. All additive; no existing export's shape changed.

## 0.2.0

### Minor Changes

- c5de366: Split `repairJson` into `repairJsonFastPath` (wrapper-strip + one `JSON.parse`) and
  `repairJsonSlowPath` (`jsonrepair()` + regex fallbacks), both now exported alongside the
  existing `repairJson` (unchanged behavior - it composes the two). Lets a caller under
  concurrent load keep the cheap fast path inline and only dispatch the expensive slow path to
  a worker thread. Also exports `resolveEnvelopeFromRepair` (same dispatch as `resolveEnvelope`,
  taking an already-computed repair result) and adds an additive `strategy` field
  (`"clean" | "wrapper_stripped" | "jsonrepair" | "loose_kv" | "trailing_blob"`) to
  `RepairResult`'s `ok: true` branch, for repair-audit confidence tracking.
