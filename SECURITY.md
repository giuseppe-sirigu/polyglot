# Security Policy

## Supported versions

This project is pre-1.0 and moving quickly. Only the latest published release is supported with security fixes — please upgrade before reporting an issue if you're not on the latest version.

## Automated scanning

CI runs [CodeQL](https://codeql.github.com/) (security-extended query suite) on every push and PR, plus a weekly scheduled scan, and [Dependabot](https://docs.github.com/en/code-security/dependabot) alerts flag known CVEs in dependencies as they're disclosed, with a weekly scan for outdated versions on top. Findings from either don't need a separate report — they're visible in the repo's Security tab.

## Reporting a vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/giuseppe-sirigu/polyglot/security/advisories/new) (Security tab → "Report a vulnerability") rather than a public issue. This is an early-stage, mostly solo-maintained project, so response times are best-effort, not SLA-backed — but reports are taken seriously and acknowledged as quickly as possible.

Please don't open a public issue for anything that could be actively exploited before a fix ships.

## Scope

A few things are worth understanding rather than reporting as vulnerabilities:

- **The agent executes shell commands and reads/writes files by design.** That's the product. Permission mode (`manual`/`auto`/`plan`) controls when it's allowed to do so without asking — if you want it to never touch anything without approval, run in `manual` mode. This is documented behavior, not a bug.
- **Prompt injection from tool results is a known, actively-mitigated class of risk**, not something to report generically — the streaming parser only scans assistant-generated turns, never tool-result content, specifically so that a fetched web page or file containing text that looks like a `<tool_call>` block can't be re-parsed as an executable call. If you find a way around that specific protection, that *is* worth a report.
- **MCP servers you configure run with whatever access you grant them** — this project doesn't sandbox third-party MCP servers beyond the same permission-gate mechanism as built-in tools.
- **Conversation data is stored unencrypted under `~/.polyglot/`, by design.** Transcripts (`sessions/*.jsonl`) and proposed plans (`plans/*.md`) are plaintext. There is deliberately no app-level at-rest encryption — a key on the same disk adds little over full-disk encryption and breaks ordinary tooling. The provided controls are `persistTranscripts: false` / `--no-persist` (write nothing) and `retentionDays` (auto-delete old files); see the [Data handling](README.md#data-handling) section of the README. Conversation content is sent only to the model provider you configure (a local model keeps it on the machine); `web_search` additionally sends its query to the configured search backend (DuckDuckGo by default, or SearXNG/Tavily/Brave); the sole other network call is a version check to the npm registry.

If you're unsure whether something is a vulnerability or expected behavior, report it anyway — a false positive costs a few minutes; a missed real issue costs more.
