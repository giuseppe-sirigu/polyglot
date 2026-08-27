import { minimatch } from "minimatch";
import type { PermissionRequest } from "./gate.js";

/** Picks the field of a tool's input that a rule pattern should match against -
 * the command for bash, the path for file tools, the url for web_fetch, etc. */
function ruleSubject(request: PermissionRequest): string | null {
  const input = request.input as Record<string, unknown> | undefined;
  if (!input || typeof input !== "object") return null;
  for (const key of ["command", "path", "pattern", "url"]) {
    const value = input[key];
    if (typeof value === "string") return value;
  }
  return null;
}

/**
 * A rule is `toolName` (matches any call to that tool) or `toolName:pattern`
 * (matches only if the tool's primary argument - command/path/pattern/url -
 * matches the glob pattern), e.g. "bash:git *" or "write_file:src/**".
 */
export function ruleMatches(rule: string, request: PermissionRequest): boolean {
  const colonIdx = rule.indexOf(":");
  const toolPattern = colonIdx === -1 ? rule : rule.slice(0, colonIdx);
  const argPattern = colonIdx === -1 ? null : rule.slice(colonIdx + 1);

  if (!minimatch(request.toolName, toolPattern)) return false;
  if (argPattern === null) return true;

  const subject = ruleSubject(request);
  if (subject === null) return false;
  return minimatch(subject, argPattern);
}

export function matchesAny(rules: string[], request: PermissionRequest): boolean {
  return rules.some((rule) => ruleMatches(rule, request));
}
