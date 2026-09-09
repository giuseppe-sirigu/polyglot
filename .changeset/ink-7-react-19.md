---
"@usepolyglot/cli": patch
---

Internal: upgrade `ink` to 7.x and `react` to 19.x (ink 6+ requires React 19). The only source change is in the input box: ink 7's key parser now reports `home` / `end` / `backspace` / `delete` correctly and distinctly, so the previous workaround - a listener on ink's private `internal_eventEmitter` that read raw escape sequences for those keys - is gone, replaced by normal `useInput` handling. Home/End/Backspace/Forward-delete editing behaves the same; verified in a real terminal.
