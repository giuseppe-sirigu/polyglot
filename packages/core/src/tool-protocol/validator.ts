import { Ajv, type ValidateFunction } from "ajv";
import type { JsonSchema } from "../tools/types.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const cache = new Map<JsonSchema, ValidateFunction>();

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateAgainstSchema(schema: JsonSchema, input: unknown): ValidationResult {
  const cached = cache.get(schema);
  const validate = cached ?? ajv.compile(schema);
  if (!cached) {
    cache.set(schema, validate);
  }

  const ok = validate(input);
  if (ok) return { ok: true, errors: [] };

  // Dedupe, and for "additionalProperties" name the offending property - ajv's default message
  // is just "must NOT have additional properties" with the property name tucked away in
  // e.params instead of e.message, and it emits one identical-looking error per extra property,
  // which left the model unable to tell what to actually remove.
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const e of validate.errors ?? []) {
    const path = e.instancePath || "(root)";
    const message =
      e.keyword === "additionalProperties"
        ? `${path} must NOT have additional property "${(e.params as { additionalProperty?: string }).additionalProperty ?? "?"}"`
        : `${path} ${e.message ?? "is invalid"}`;
    if (!seen.has(message)) {
      seen.add(message);
      errors.push(message);
    }
  }
  return { ok: false, errors };
}
