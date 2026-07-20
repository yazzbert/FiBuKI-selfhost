# CodeQL dismissals for Stefan — reviewed 2026-07-20

Claude's classifier blocks alert dismissal (and writing a dismissal script),
so these are documented here for Stefan to run manually. Each was reviewed
in the 2026-07-20 backlog session; comments are ≤280 chars.

**Update 2026-07-21:** after PRs #3–#6 merged, the main scans closed #32
and #87 as *fixed* (the source-check / chmod hardening broke those flows),
so only #33, #81, #82 still need dismissal. Their commands remain below;
the #32/#87 entries were removed.

Run with `gh` (`~/.local/bin/gh`, authed as yazzbert):

```bash
REPO="yazzbert/FiBuKI-selfhost"

# #33 js/insufficient-password-hash — functions/src/api-keys/index.ts:44
# FALSE POSITIVE: hashes a server-generated API key (fk_ + 128-bit randomBytes
# hex) for lookup, not a password. SHA-256 is appropriate for high-entropy tokens.
gh api -X PATCH "repos/$REPO/code-scanning/alerts/33" \
  -f state=dismissed -f dismissed_reason="false positive" \
  -f dismissed_comment="Not a password: hashes a server-generated API key (fk_ + 128-bit randomBytes hex) for lookup. SHA-256 is appropriate for high-entropy tokens; bcrypt/PBKDF2 is only needed for low-entropy user passwords."

# #81/#82 js/clear-text-logging — cli/lib/auth.mjs (printing the API key)
# BY DESIGN: --format env|mcp exist to print the newly issued key once.
gh api -X PATCH "repos/$REPO/code-scanning/alerts/81" \
  -f state=dismissed -f dismissed_reason="won't fix" \
  -f dismissed_comment="By design: 'fibuki auth --format env' prints the newly issued API key once so the user can copy it into their environment. Shown only to the user who just authorized it, on their own terminal."
gh api -X PATCH "repos/$REPO/code-scanning/alerts/82" \
  -f state=dismissed -f dismissed_reason="won't fix" \
  -f dismissed_comment="By design: 'fibuki auth --format mcp' prints a Claude Desktop MCP config containing the newly issued API key for the user to paste. Shown once, to the user who just authorized it, on their own terminal."
```

## Push + PR commands — DONE 2026-07-20/21

All four branches were pushed and merged as PRs #3–#6; the main scans
confirmed the fixes. Kept below for the command pattern only.

```bash
git push -u origin codeql/cli-auth codeql/extension-sandbox codeql/request-forgery codeql/format-strings

gh pr create --base main --head codeql/cli-auth \
  --title "fix(cli): spawn browser opener without a shell; chmod 600 saved config" \
  --body "CodeQL #34 js/command-line-injection (+ hardening for #87). See commit message."

gh pr create --base main --head codeql/extension-sandbox \
  --title "fix(extension): authenticate sandbox postMessage channel" \
  --body "CodeQL #37/#113/#114/#123 (postMessage origin/source checks + guarded callback dispatch). Bumps manifest to 0.0.2 per RELEASING.md. See commit message."

gh pr create --base main --head codeql/request-forgery \
  --title "fix(app): URL-encode identifiers embedded in outbound API request paths" \
  --body "CodeQL #25–#30 js/request-forgery. encodeURIComponent on messageId/threadId/webFormId/accountId at interpolation sites; no-op for legitimate IDs. See commit message."

gh pr create --base main --head codeql/format-strings \
  --title "fix(app): keep tainted values out of console format strings" \
  --body "CodeQL #66/#67/#68 js/tainted-format-string. Tainted values moved to %s/%d arguments; byte-identical output. See commit message."
```

Note: alerts only close after the PRs merge and the push-to-main scan runs.
