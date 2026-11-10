#!/usr/bin/env bash
# Checks the structure of a report. Prints "IMPLEMENTACJA OK" or "IMPLEMENTACJA ODRZUCONA" with the list of problems.
f=""
while [ $# -gt 0 ]; do case "$1" in --report) f="$2"; shift 2;; *) [ -f "$1" ] && f="$1"; shift;; esac; done
[ -n "$f" ] && [ -f "$f" ] || { echo "IMPLEMENTACJA ODRZUCONA"; echo "- report file not found: $f"; exit 1; }
problems=()
need() { grep -Eiq "$1" "$f" || problems+=("$2"); }

need '^## Procedure' 'missing section "## Procedure"'
need '^[0-9]+\. \[(CRITICAL|HIGH|MEDIUM|LOW)\]' 'no procedure step with a priority tag'
need '=>' 'steps have no expected result after "=>"'
need '^## Priorities' 'missing section "## Priorities"'
need '^## Estimate' 'missing section "## Estimate"'
need '^## Traceability' 'missing section "## Traceability"'
chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "IMPLEMENTACJA OK"; exit 0; fi
echo "IMPLEMENTACJA ODRZUCONA"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
