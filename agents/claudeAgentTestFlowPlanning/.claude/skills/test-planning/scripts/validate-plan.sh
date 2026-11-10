#!/usr/bin/env bash
# Checks the structure of a report. Prints "PLAN OK" or "PLAN ODRZUCONY" with the list of problems.
f=""
while [ $# -gt 0 ]; do case "$1" in --plan) f="$2"; shift 2;; *) [ -f "$1" ] && f="$1"; shift;; esac; done
[ -n "$f" ] && [ -f "$f" ] || { echo "PLAN ODRZUCONY"; echo "- report file not found: $f"; exit 1; }
problems=()
need() { grep -Eiq "$1" "$f" || problems+=("$2"); }

need '^Priority:' 'missing line "Priority:"'
need '^## Static' 'missing section "## Static and white box check"'
need '^Impossible or contradictory assumptions:' 'missing line "Impossible or contradictory assumptions:"'
need '^## Risks' 'missing section "## Risks"'
need '\[product\]' 'no product risk'
need '^## Entry criteria' 'missing section "## Entry criteria"'
need '^## Exit criteria' 'missing section "## Exit criteria"'
need 'STATUS: (GOTOWY DO FAZY 2|WYMAGA POPRAWY)' 'missing verdict "STATUS: GOTOWY DO FAZY 2" or "STATUS: WYMAGA POPRAWY"'
grep -E '^- \[(product|project)\]' "$f" | grep -vq 'src:' && problems+=("a risk without (src: ...)")
chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "PLAN OK"; exit 0; fi
echo "PLAN ODRZUCONY"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
