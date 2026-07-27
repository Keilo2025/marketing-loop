---
description: Open the approval canvas so a human can approve, edit or reject the proposed copy changes
argument-hint: "[optional: --port 7788]"
allowed-tools: Bash, Read
---

Check that `.marketing-loop/proposals.json` exists and has pending proposals. If it does not, run `/marketing-loop` first.

Then open the canvas:

```bash
npx marketing-loop@latest review --ui $ARGUMENTS
```

Tell the user:

- the URL it is serving on
- that every proposal shows the current copy, the rewrite, the reasoning and the evidence, and that the rewrite box is editable — whatever they type wins
- keyboard shortcuts: `j`/`k` to move, `a` to approve, `r` to reject
- that nothing is written to their code until they press **Apply**, and that `npx marketing-loop revert` undoes the last run

If they would rather not open a browser, offer the markdown route instead:

```bash
npx marketing-loop@latest review          # writes review.md with tick boxes
npx marketing-loop@latest review --collect # reads their ticks back
npx marketing-loop@latest apply
```

Do not approve anything on their behalf.
