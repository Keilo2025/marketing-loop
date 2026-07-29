---
description: Open human review for pending source-catalogue copy changes
argument-hint: "[optional: --port 7788]"
allowed-tools: Bash, Read
---

Marketing-loop reads only the configured source catalogue and never changes application code or target locales.

If `.marketing-loop/agent-output.json` exists, run `npx marketing-loop@latest import`. Then open review:

```bash
npx marketing-loop@latest review --ui $ARGUMENTS
```

Tell the user the URL, that the rewrite is editable, and that no source-catalogue change is written until they approve and explicitly run `apply`. Ask them to explain rejections so later proposal runs can use that history. Approved source edits make translations stale; when language-loop is available, run translation only after these marketing decisions settle.

For an active unified run, prefer `npx marketing-loop@latest content --ui`.
After the user decides, rerun `content`, then `content --llm`. Preserve its
persisted message filter and do not claim completion while any selected
language remains pending, rework, or needs human review.

For markdown review:

```bash
npx marketing-loop@latest review
npx marketing-loop@latest review --collect
npx marketing-loop@latest apply
```

Do not approve changes or edit target locales on the user's behalf.
