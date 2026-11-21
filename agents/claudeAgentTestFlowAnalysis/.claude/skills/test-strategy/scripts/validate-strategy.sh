#!/usr/bin/env bash
# Checks the structure and the arithmetic of a report. Prints "ANALIZA OK" or "ANALIZA ODRZUCONA" with the list of problems.
# Structure: every section, a technique line and a matrix line for every condition, the scope naming its conditions.
# Arithmetic: items = existing + to execute per condition, totals equal the sums, priorities add up, and the numbers of
# "Done criteria" agree with the totals.
f=""
while [ $# -gt 0 ]; do case "$1" in --report) f="$2"; shift 2;; *) [ -f "$1" ] && f="$1"; shift;; esac; done
[ -n "$f" ] && [ -f "$f" ] || { echo "ANALIZA ODRZUCONA"; echo "- report file not found: $f"; exit 1; }
problems=()
need() { grep -Eiq "$1" "$f" || problems+=("$2"); }
# Text of one section: from its "## " heading to the next one.
sec() { awk -v h="## $1" '/^## /{p=($0==h)} p' "$f"; }
num() { grep -Eo "$1" | head -1 | grep -Eo '[0-9]+' | head -1; }

need '^## Strategy' 'missing section "## Strategy"'
need '^## Test conditions' 'missing section "## Test conditions"'
need '^## Technique selection' 'missing section "## Technique selection"'
need '^## Coverage[[:space:]]*$' 'missing section "## Coverage"'
need '^## Impact of the change' 'missing section "## Impact of the change"'
need '^## Check of assumptions' 'missing section "## Check of assumptions"'
need '^## Coverage matrix' 'missing section "## Coverage matrix"'
need '^## Done criteria' 'missing section "## Done criteria"'
need '^## Scope for test design' 'missing section "## Scope for test design"'
need '^[0-9]+\. \[(high|medium|low)\]' 'the scope has no item tagged [high], [medium] or [low]'

# Conditions: an id, a priority tag and a requirement on every line.
conds=$(sec 'Test conditions' | grep -E '^- TC[0-9]+ ' || true)
if [ -z "$conds" ]; then
  problems+=('"Test conditions" has no line "- TC<n> [high|medium|low] (R<n>) <condition> (src: ...)"')
else
  echo "$conds" | grep -Evq '^- TC[0-9]+ \[(high|medium|low)\] ' && problems+=('every condition needs a priority tag right after its id: "- TC1 [high] (R1) ..."')
  echo "$conds" | grep -Evq '\(R[0-9]+' && problems+=('every condition names the requirement it serves, for example (R1)')
fi
ids_c=$(echo "$conds" | grep -Eo '^- TC[0-9]+' | sort -u)
dup=$(echo "$conds" | grep -Eo '^- TC[0-9]+' | sort | uniq -d | tr '\n' ' ')
[ -z "$dup" ] || problems+=("condition ids used twice: $dup")

# Technique selection: exactly one line per condition, five fields.
tech=$(sec 'Technique selection' | grep -E '^- TC[0-9]+ ' || true)
ids_t=$(echo "$tech" | grep -Eo '^- TC[0-9]+' | sort -u)
if [ -n "$ids_c" ]; then
  miss=$(comm -23 <(echo "$ids_c") <(echo "$ids_t") | sed 's/^- //' | tr '\n' ' ')
  [ -z "$miss" ] || problems+=("no line in \"Technique selection\" for: $miss")
  extra=$(comm -13 <(echo "$ids_c") <(echo "$ids_t") | sed 's/^- //' | tr '\n' ' ')
  [ -z "$extra" ] || problems+=("\"Technique selection\" names conditions that do not exist: $extra")
fi
if [ -n "$tech" ]; then
  echo "$tech" | grep -Evq '\| *(strong|standard|light) *\|' && problems+=('every technique line needs the strength: strong, standard or light')
  echo "$tech" | awk -F'|' 'NF < 6 {bad=1} END {exit !bad}' && problems+=('a technique line has fewer than six fields: id | kind | technique(s) | strength | items | why this and not another')
fi

# Coverage matrix: per condition items = existing + to execute, totals, priorities.
mx=$(sec 'Coverage matrix' | grep -E '^- TC[0-9]+ ' || true)
tot=$(sec 'Coverage matrix' | grep -E '^Totals:' | head -1 || true)
sumI=0; sumE=0; sumG=0; sumH=0; sumM=0; sumL=0
if [ -z "$mx" ]; then
  problems+=('"Coverage matrix" has no line "- TC<n> [priority] (R<n>) | items: <n> | existing: <n> | to execute: <n> | ..."')
else
  while IFS= read -r l; do
    id=$(echo "$l" | grep -Eo '^- TC[0-9]+' | sed 's/^- //')
    pr=$(echo "$l" | grep -Eo '\[(high|medium|low)\]' | head -1 | tr -d '[]')
    i=$(echo "$l" | num 'items: *[0-9]+'); e=$(echo "$l" | num 'existing: *[0-9]+'); g=$(echo "$l" | num 'to execute: *[0-9]+')
    if [ -z "$pr" ] || [ -z "$i" ] || [ -z "$e" ] || [ -z "$g" ]; then problems+=("matrix line of $id needs a priority tag and the fields items, existing and to execute"); continue; fi
    [ "$i" -eq $((e + g)) ] || problems+=("$id: items $i is not existing $e + to execute $g")
    [ "$i" -ge 1 ] || problems+=("$id: a condition needs at least one coverage item")
    sumI=$((sumI + i)); sumE=$((sumE + e)); sumG=$((sumG + g))
    case "$pr" in high) sumH=$((sumH + i));; medium) sumM=$((sumM + i));; low) sumL=$((sumL + i));; esac
    # The priority of the condition and of its matrix line must agree.
    pc=$(echo "$conds" | grep -E "^- $id " | grep -Eo '\[(high|medium|low)\]' | head -1 | tr -d '[]')
    [ -z "$pc" ] || [ "$pc" = "$pr" ] || problems+=("$id: priority [$pr] in the matrix, [$pc] in the conditions")
  done <<< "$mx"
  ids_m=$(echo "$mx" | grep -Eo '^- TC[0-9]+' | sort -u)
  if [ -n "$ids_c" ]; then
    miss=$(comm -23 <(echo "$ids_c") <(echo "$ids_m") | sed 's/^- //' | tr '\n' ' ')
    [ -z "$miss" ] || problems+=("no line in \"Coverage matrix\" for: $miss")
  fi
fi
th=""; if [ -z "$tot" ]; then
  problems+=('"Coverage matrix" has no line "Totals: items <N> | existing <E> | to execute <G> | high <h> | medium <m> | low <l>"')
else
  tN=$(echo "$tot" | num 'items [0-9]+'); tE=$(echo "$tot" | num 'existing [0-9]+'); tG=$(echo "$tot" | num 'to execute [0-9]+')
  tH=$(echo "$tot" | num 'high [0-9]+'); tM=$(echo "$tot" | num 'medium [0-9]+'); tL=$(echo "$tot" | num 'low [0-9]+')
  if [ -z "$tN$tE$tG$tH$tM$tL" ] || [ -z "$tN" ] || [ -z "$tE" ] || [ -z "$tG" ] || [ -z "$tH" ] || [ -z "$tM" ] || [ -z "$tL" ]; then
    problems+=('the Totals line needs all six numbers: items, existing, to execute, high, medium, low')
  else
    th=ok
    [ "$tN" -eq "$sumI" ] || problems+=("Totals items $tN, but the matrix lines add up to $sumI")
    [ "$tE" -eq "$sumE" ] || problems+=("Totals existing $tE, but the matrix lines add up to $sumE")
    [ "$tG" -eq "$sumG" ] || problems+=("Totals to execute $tG, but the matrix lines add up to $sumG")
    [ "$tH" -eq "$sumH" ] || problems+=("Totals high $tH, but the [high] matrix lines add up to $sumH")
    [ "$tM" -eq "$sumM" ] || problems+=("Totals medium $tM, but the [medium] matrix lines add up to $sumM")
    [ "$tL" -eq "$sumL" ] || problems+=("Totals low $tL, but the [low] matrix lines add up to $sumL")
    [ "$tN" -eq $((tH + tM + tL)) ] || problems+=("Totals items $tN is not high $tH + medium $tM + low $tL")
  fi
fi

# Done criteria: the gates, with numbers that agree with the totals.
dc=$(sec 'Done criteria')
echo "$dc" | grep -Eq '^Source of thresholds:[[:space:]]*\S' || problems+=('"Done criteria" needs the line "Source of thresholds: <file name | default (the team states none)>"')
gate() { # label, total-from-matrix
  local lab="$1" want="$2" line a b
  line=$(echo "$dc" | grep -E "^- $lab items: *[0-9]+ of [0-9]+" | head -1 || true)
  if [ -z "$line" ]; then problems+=("\"Done criteria\" needs the line \"- $lab items: <a> of <n> executed (<p>%)\""); return; fi
  a=$(echo "$line" | grep -Eo '[0-9]+ of' | head -1 | grep -Eo '[0-9]+'); b=$(echo "$line" | grep -Eo 'of [0-9]+' | head -1 | grep -Eo '[0-9]+')
  [ "$a" -le "$b" ] || problems+=("$lab items: $a of $b, the required number cannot exceed the total")
  [ -z "$th" ] || [ "$b" -eq "$want" ] || problems+=("$lab items: $b in \"Done criteria\", but $want in the matrix")
  if [ "$lab" = "High" ]; then
    [ "$a" -eq "$b" ] || problems+=("High items must all be executed: $a of $b, the gate is 100% (a team threshold must be named in \"Source of thresholds\")")
  fi
}
if [ -n "$th" ]; then gate High "$tH"; gate Medium "$tM"; gate Low "$tL"; else gate High "$sumH"; gate Medium "$sumM"; gate Low "$sumL"; fi
for lab in 'Every condition' 'Requirements' 'Impact' 'Regression' 'Defects'; do
  echo "$dc" | grep -Eq "^- $lab:[[:space:]]*\S" || problems+=("\"Done criteria\" needs the line \"- $lab: ...\"")
done
ov=$(echo "$dc" | grep -E '^- Overall:' | head -1 || true)
if [ -z "$ov" ]; then problems+=('"Done criteria" needs the line "- Overall: <a> of <N> items (<p>%), for information; ..."')
elif [ -n "$th" ]; then
  oN=$(echo "$ov" | grep -Eo 'of [0-9]+' | head -1 | grep -Eo '[0-9]+')
  [ "$oN" = "$tN" ] || problems+=("Overall counts $oN items, but the matrix has $tN")
fi

# Scope: every numbered item names its conditions, every condition with a gap is in the scope.
scope=$(sec 'Scope for test design' | grep -E '^[0-9]+\. \[' || true)
if [ -n "$scope" ]; then
  echo "$scope" | grep -Evq 'TC[0-9]+' && problems+=('every item of the scope names its conditions, for example (TC1, TC3)')
  while IFS= read -r l; do
    id=$(echo "$l" | grep -Eo '^- TC[0-9]+' | sed 's/^- //')
    g=$(echo "$l" | num 'to execute: *[0-9]+')
    if [ -n "$id" ] && [ -n "$g" ] && [ "$g" -gt 0 ] && ! echo "$scope" | grep -Eq "\b$id\b"; then problems+=("$id has $g items to execute, but no item of the scope names it"); fi
  done <<< "$mx"
fi

chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "ANALIZA OK"; exit 0; fi
echo "ANALIZA ODRZUCONA"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
