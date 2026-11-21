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
sec() { awk -v s="$1" 'index($0, "## " s) == 1 {on=1; next} /^## /{on=0} on' "$f"; }
lvl() { case "$1" in low) echo 1;; medium) echo 2;; high) echo 3;; *) echo 0;; esac; }
risks=$(grep -E '^- \[(product|project)\]' "$f" || true)
nr=$(printf '%s\n' "$risks" | grep -c . || true)
[ "$nr" -le 12 ] || problems+=("$nr risks: at most 12, merge risks with the same cause")
dup=$(printf '%s\n' "$risks" | grep -Eo '\] [PJ][0-9]+' | grep -Eo '[PJ][0-9]+' | sort | uniq -d | tr '\n' ' ')
[ -z "$dup" ] || problems+=("duplicate risk id(s): $dup")
hh=0
while IFS= read -r l; do
  [ -z "$l" ] && continue
  kind=$(printf '%s' "$l" | grep -Eo '^- \[(product|project)\]' | grep -Eo 'product|project')
  id=$(printf '%s' "$l" | grep -Eo '^- \[(product|project)\] [PJ][0-9]+' | grep -Eo '[PJ][0-9]+$')
  [ -n "$id" ] || { problems+=("a risk has no id (P1... for product, J1... for project): ${l:0:60}"); continue; }
  { [ "$kind" = product ] && [ "${id:0:1}" = P ]; } || { [ "$kind" = project ] && [ "${id:0:1}" = J ]; } || problems+=("risk $id: product risks use P<n>, project risks J<n>")
  L=$(printf '%s' "$l" | grep -Eo 'likelihood: *(low|medium|high)' | grep -Eo '(low|medium|high)$')
  I=$(printf '%s' "$l" | grep -Eo 'impact: *(low|medium|high)' | grep -Eo '(low|medium|high)$')
  E=$(printf '%s' "$l" | grep -Eo 'exposure: *(low|medium|high)' | grep -Eo '(low|medium|high)$')
  if [ -z "$L" ] || [ -z "$I" ] || [ -z "$E" ]; then problems+=("risk $id needs likelihood, impact and exposure (low, medium or high)"); continue; fi
  sc=$(( $(lvl "$L") * $(lvl "$I") ))
  if [ "$sc" -ge 6 ]; then want=high; elif [ "$sc" -ge 3 ]; then want=medium; else want=low; fi
  [ "$E" = "$want" ] || problems+=("risk $id: likelihood $L x impact $I gives exposure $want, the line says $E")
  [ "$kind" = product ] && [ "$L" = high ] && [ "$I" = high ] && hh=$((hh+1))
done <<< "$risks"
# priority follows the risks
pr=$(grep -Em1 '^Priority:' "$f" || true)
printf '%s' "$pr" | grep -Eq '^Priority: *(High|Medium|Low|Not enough data)\b' || problems+=('Priority must start with High, Medium, Low or Not enough data')
[ "$hh" -eq 0 ] || printf '%s' "$pr" | grep -Eq '^Priority: *High\b' || problems+=("a product risk is high likelihood and high impact, so the priority must be High")
# criteria: counted, sourced, measurable, no vague words
for s in 'Entry criteria' 'Exit criteria'; do
  body=$(sec "$s"); n=$(printf '%s\n' "$body" | grep -c '^- ' || true)
  [ "$n" -ge 2 ] || problems+=("\"$s\" needs at least two criteria, it has $n")
  [ "$n" -le 8 ] || problems+=("\"$s\" has $n criteria, at most 8")
  printf '%s\n' "$body" | grep -E '^- ' | grep -vq 'src:' && problems+=("a criterion in \"$s\" has no (src: ...)")
  printf '%s\n' "$body" | grep -E '^- ' | grep -vq 'measure:' && problems+=("a criterion in \"$s\" has no \"measure: ...\"")
  printf '%s\n' "$body" | grep -E '^- ' | grep -Eiq '\b(ready|done|stable|sufficient|appropriate|adequate|as needed|enough|good|working|tested)\b' && problems+=("a criterion in \"$s\" uses a vague word (ready, done, stable, sufficient, appropriate, adequate, as needed, enough, good, working, tested): state the measure")
done
# the impossible-assumptions line cites code when a repository is connected
imp=$(grep -Em1 '^Impossible or contradictory assumptions:' "$f" || true)
none=0; printf '%s' "$imp" | grep -Eiq ': *none\b' && none=1
if [ "$none" -eq 0 ] && ! grep -Eiq '^Repo/mode:.*no repository' "$f"; then
  printf '%s' "$imp" | grep -Eq '[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:[0-9]+' || problems+=('impossible assumptions are listed without file:line')
fi
# verdict follows from the rules; WYMAGA needs blockers
if grep -Eq 'STATUS: GOTOWY DO FAZY 2' "$f"; then
  [ "$hh" -eq 0 ] || problems+=("verdict GOTOWY DO FAZY 2, but a product risk is high likelihood and high impact")
  [ "$none" -eq 1 ] || problems+=("verdict GOTOWY DO FAZY 2, but impossible or contradictory assumptions are listed")
fi
if grep -Eq 'STATUS: WYMAGA POPRAWY' "$f"; then
  vline=$(grep -E 'STATUS: WYMAGA POPRAWY' "$f" | head -1)
  printf '%s' "$vline" | grep -Eq '\b[PJ][0-9]+\b|[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:[0-9]+|assumption' || problems+=('verdict WYMAGA POPRAWY must name the risk ids or the assumption (file:line) in its reason')
  grep -Eq '^- B[0-9]+ ' "$f" || problems+=('verdict WYMAGA POPRAWY needs "Blockers:" lines "- B1 <what must change> (risk P2) | ask: <question>"')
  grep -E '^- B[0-9]+ ' "$f" | grep -vq 'ask:' && problems+=('a blocker has no "ask: <question>"')
fi
chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "PLAN OK"; exit 0; fi
echo "PLAN ODRZUCONY"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
