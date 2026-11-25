#!/usr/bin/env bash
# Checks the structure of a report. Prints "PROJEKT OK" or "PROJEKT ODRZUCONY" with the list of problems.
f=""
while [ $# -gt 0 ]; do case "$1" in --design) f="$2"; shift 2;; *) [ -f "$1" ] && f="$1"; shift;; esac; done
[ -n "$f" ] && [ -f "$f" ] || { echo "PROJEKT ODRZUCONY"; echo "- report file not found: $f"; exit 1; }
problems=()
need() { grep -Eiq "$1" "$f" || problems+=("$2"); }

need '^Business cases:' 'missing line "Business cases:"'
need '^Bug patterns:' 'missing line "Bug patterns:"'
need '^## [0-9]+\. ' 'no numbered section "## 1. <title> [technique]"'
need '^- .*=>' 'no check in the form "- <action> => <expected>"'
need '^## Summary' 'missing section "## Summary"'
need '^## To confirm' 'missing section "## To confirm"'
grep -E '^- .*=>' "$f" | grep -vq '(src:' && problems+=("a check without (src: ...)")
n=$(grep -Ec '^## [0-9]+\. ' "$f"); [ "$n" -le 8 ] || problems+=("more than 8 sections ($n)")
# A section is a business situation, never a technique or a validation (the application rejects such titles too).
bad=$(grep -Ei '^## [0-9]+\. *(equivalence (partition|class)|boundary|decision table|state transition|pairwise|validation|field validation|input validation)' "$f" | sed -E 's/^## [0-9]+\. *//' | head -3 | tr '\n' ';')
[ -z "$bad" ] || problems+=("a section title names a technique or a validation instead of a business situation: $bad")
# Coverage of the Analysis conditions, when the design was given the Analysis report (WORK_DIR/coverage-input.md).
ci="$(dirname "$f")/coverage-input.md"
if [ -f "$ci" ]; then
  line=$(grep -Em1 '^Coverage:' "$f" || true)
  if [ -z "$line" ]; then problems+=('missing line "Coverage: TC1→§1 | TC2→To confirm" (coverage-input.md lists the conditions of the Analysis report)')
  else
    miss=""
    for tc in $(grep -Eo 'TC[0-9]+' "$ci" | sort -u); do printf '%s' "$line" | grep -Eq "\b$tc *(→|->) *(§[0-9]+|To confirm)" || miss="$miss $tc"; done
    [ -z "$miss" ] || problems+=("the line \"Coverage:\" does not map these conditions to a section or To confirm:$miss")
  fi
fi
# Rule models of the techniques (skill technique-coverage): when the file exists it must be a JSON array of models.
tm="$(dirname "$f")/technique-models.json"
if [ -f "$tm" ]; then
  if command -v node >/dev/null 2>&1; then
    err=$(node -e 'let j;try{j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))}catch(e){console.log("not valid JSON: "+e.message);process.exit()}const a=Array.isArray(j)?j:j.models;if(!Array.isArray(a)){console.log("not an array of models");process.exit()}a.forEach((m,i)=>{if(!m||!m.kind||!m.id)console.log("model "+(i+1)+" has no kind or id");else if(!m.src)console.log("model "+m.id+" has no src")})' "$tm")
    [ -z "$err" ] || problems+=("technique-models.json: $(printf '%s' "$err" | head -3 | tr '\n' ';')")
  fi
fi
grep -E '^- .*=>' "$f" | grep -E '\(src:[^)]*\bci *:' | grep -Eqv '\bci *: *(EP|BVA|DT|ST|PW):' && problems+=("a check has \"ci:\" without a coverage item id (EP:/BVA:/DT:/ST:/PW:...)")
chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "PROJEKT OK"; exit 0; fi
echo "PROJEKT ODRZUCONY"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
