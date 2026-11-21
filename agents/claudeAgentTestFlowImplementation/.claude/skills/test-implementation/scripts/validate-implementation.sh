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
need '^## Setup' 'missing section "## Setup"'
need '^## Cleanup' 'missing section "## Cleanup"'
# every procedure step names the design check it comes from
steps=$(grep -Ec '^[0-9]+\. \[(CRITICAL|HIGH|MEDIUM|LOW)\]' "$f")
refs=$(grep -E '^[0-9]+\. \[(CRITICAL|HIGH|MEDIUM|LOW)\]' "$f" | grep -Ec '\(§[0-9]')
[ "$steps" -eq "$refs" ] || problems+=("$((steps-refs)) of $steps steps have no design reference like (§2.1)")
# placeholders instead of real values
grep -Eq '<[a-z][^>]*>|\bTBD\b|\bXXX\b|\.\.\.$' <(sed -n '/^## Setup/,/^## Priorities/p' "$f") && problems+=("placeholders or unfinished text in Setup/Procedure/Cleanup (<...>, TBD, ...)")
# a status code alone is not an expected result
grep -E '^[0-9]+\. \[' "$f" | grep -Eq '=> *(HTTP )?[0-9]{3}[ .]*(\(§[^)]*\))? *$' && problems+=("a step expects only a status code; state the value, the place of reading and the state afterwards")
# estimate arithmetic: per-priority numbers add up to Total
est=$(grep -E '^Total:' "$f" | head -1)
if [ -n "$est" ]; then
  tot=$(echo "$est" | sed -E 's/^Total: *([0-9.]+).*/\1/')
  sum=$(echo "$est" | grep -Eo '(CRITICAL|HIGH|MEDIUM|LOW) [0-9.]+' | awk '{s+=$2} END{print s+0}')
  awk -v a="$tot" -v b="$sum" 'BEGIN{d=a-b; if(d<0)d=-d; exit !(d>0.6)}' && problems+=("estimate does not add up: Total $tot, priorities sum to $sum")
else
  problems+=('Estimate has no line "Total: <n> min | CRITICAL <n> | HIGH <n> | MEDIUM <n> | LOW <n>"')
fi
# traceability must cover every check of the design inventory
wd=$(dirname "$f")
if [ -f "$wd/design-input.md" ]; then
  tr=$(sed -n '/^## Traceability/,/^## Gates/p' "$f")
  miss=""
  for id in $(grep -Eo '^§[0-9]+\.[0-9]+' "$wd/design-input.md" | sort -u); do
    echo "$tr" | grep -Fq "$id" || miss="$miss $id"
  done
  [ -z "$miss" ] && true || problems+=("design checks missing in Traceability:$miss")
else
  problems+=("design-input.md not found in $wd (skill procedure-merge, step 1)")
fi
# gates: required when the Analysis report was in the input
if [ -f "$wd/coverage-input.md" ]; then
  grep -Eq '^## Gates' "$f" || problems+=('missing section "## Gates" (coverage-input.md exists)')
  for tc in $(grep -Eo '\bTC[0-9]+\b' "$wd/coverage-input.md" | sort -u); do
    sed -n '/^## Gates/,$p' "$f" | grep -Fq "$tc" || problems+=("condition $tc missing in Gates")
  done
fi
chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "IMPLEMENTACJA OK"; exit 0; fi
echo "IMPLEMENTACJA ODRZUCONA"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
