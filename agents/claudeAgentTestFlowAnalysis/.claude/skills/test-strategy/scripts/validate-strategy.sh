#!/usr/bin/env bash
# Checks the structure of a report. Prints "ANALIZA OK" or "ANALIZA ODRZUCONA" with the list of problems.
f=""
while [ $# -gt 0 ]; do case "$1" in --report) f="$2"; shift 2;; *) [ -f "$1" ] && f="$1"; shift;; esac; done
[ -n "$f" ] && [ -f "$f" ] || { echo "ANALIZA ODRZUCONA"; echo "- report file not found: $f"; exit 1; }
problems=()
need() { grep -Eiq "$1" "$f" || problems+=("$2"); }

need '^## Strategy' 'missing section "## Strategy"'
need '^## Test conditions' 'missing section "## Test conditions"'
need '^## Coverage' 'missing section "## Coverage"'
need '^## Impact of the change' 'missing section "## Impact of the change"'
need '^## Check of assumptions' 'missing section "## Check of assumptions"'
need '^## Scope for test design' 'missing section "## Scope for test design"'
need '^[0-9]+\. \[(high|medium|low)\]' 'the scope has no item tagged [high], [medium] or [low]'
chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "ANALIZA OK"; exit 0; fi
echo "ANALIZA ODRZUCONA"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
