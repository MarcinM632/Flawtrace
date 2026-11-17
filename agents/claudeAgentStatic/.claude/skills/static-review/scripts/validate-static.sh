#!/usr/bin/env bash
# Checks the structure and the completeness of a static review. Prints "STATIC OK" or "STATIC ODRZUCONY" with the list of problems.
# Completeness: the header counts match the body, every requirement is accounted for, every finding has all its fields,
# there are at least three scenarios, and the verdict follows from the findings.
f=""
while [ $# -gt 0 ]; do case "$1" in --report) f="$2"; shift 2;; *) [ -f "$1" ] && f="$1"; shift;; esac; done
[ -n "$f" ] && [ -f "$f" ] || { echo "STATIC ODRZUCONY"; echo "- report file not found: $f"; exit 1; }
problems=(); unacc=()
need() { grep -Eiq "$1" "$f" || problems+=("$2"); }
sec() { awk -v s="$1" 'index($0, "## " s) == 1 {on=1; next} /^## /{on=0} on' "$f"; }
count() { local n; n=$(printf '%s\n' "$1" | grep -Ec "$2" || true); echo "${n:-0}"; }

head -1 "$f" | grep -Eq '^[A-Z][A-Z0-9]*-[0-9]+' || problems+=("the first line must start with the ticket key, or NOTICKET-0")
need '^Repo/mode:' 'missing line "Repo/mode:"'
need '^Sources:' 'missing line "Sources:"'
for s in 'Requirements' 'Existing logic' 'Findings' 'Scenarios' 'Checked and consistent' 'Verdict'; do
  grep -Eq "^## $s" "$f" || problems+=("missing section \"## $s\"")
done
need '^## Open questions' 'missing section "## Open questions" (write "- none" when there are none)'

reqs=$(sec 'Requirements'); logic=$(sec 'Existing logic'); finds=$(sec 'Findings'); scen=$(sec 'Scenarios'); clean=$(sec 'Checked and consistent'); verdict=$(sec 'Verdict')

# Header counts must match the body.
hdr=$(grep -Em1 '^Review:' "$f" || true)
if [ -z "$hdr" ]; then
  problems+=('missing line "Review: static, ... | requirements: <n> | findings: <n> | scenarios: <n> | code files read: <n>"')
else
  for k in requirements findings scenarios 'code files read'; do
    printf '%s' "$hdr" | grep -Eiq "$k: *[0-9]+" || problems+=("the Review line has no \"$k: <n>\" field")
  done
fi
hv() { printf '%s' "$hdr" | grep -Eio "$1: *[0-9]+" | grep -Eo '[0-9]+' | head -1; }

# Requirements
nR=$(count "$reqs" '^R[0-9]+ \[')
[ "$nR" -ge 1 ] || problems+=('no requirement lines "R1 [type] ..." in "## Requirements"')
h=$(hv requirements); [ -z "$h" ] || [ "$h" = "$nR" ] || problems+=("Review line says $h requirements, the section has $nR")
printf '%s\n' "$reqs" | grep -E '^R[0-9]+ ' | grep -vq 'src:' && problems+=('a requirement has no (src: ...)')

# Findings
nF=$(count "$finds" '^[0-9]+\. \[(Impossible|Inconsistency|Logic error|Gap|Ambiguity|Duplicate|Impact|Interface|Untestable)\] \[(Critical|Major|Minor)\] ')
nAny=$(count "$finds" '^[0-9]+\. ')
[ "$nAny" = "$nF" ] || problems+=("$((nAny - nF)) finding title(s) without the form \"N. [Class] [Critical|Major|Minor] title\" (classes: Impossible, Inconsistency, Logic error, Gap, Ambiguity, Duplicate, Impact, Interface, Untestable)")
h=$(hv findings); [ -z "$h" ] || [ "$h" = "$nF" ] || problems+=("Review line says $h findings, the section has $nF")
if [ "$nF" -eq 0 ]; then
  printf '%s\n' "$finds" | grep -Eq '^none: .{20,}' || problems+=('no findings: write one line "none: <why the task is sound>" in "## Findings"')
else
  for k in 'Requirement' 'Task says' 'System or source says' 'Why it matters' 'Question for the author' 'Suggested wording'; do
    n=$(count "$finds" "^$k:")
    [ "$n" -ge "$nF" ] || problems+=("$nF findings but only $n \"$k:\" lines: every finding needs all six fields")
  done
  for k in 'Task says' 'System or source says'; do
    miss=$(printf '%s\n' "$finds" | grep -E "^$k:" | grep -vc 'src:' || true)
    [ "${miss:-0}" -eq 0 ] || problems+=("$miss \"$k:\" line(s) without (src: ...)")
  done
  printf '%s\n' "$finds" | grep -E '^Question for the author:' | grep -Evq '\?' && problems+=('a "Question for the author:" is not a question (no question mark)')
  # A finding must point at a requirement that exists.
  for id in $(printf '%s\n' "$finds" | grep -E '^Requirement:' | grep -Eo 'R[0-9]+' | sort -u); do
    printf '%s\n' "$reqs" | grep -Eq "^$id " || problems+=("a finding points at $id, which is not in \"## Requirements\"")
  done
fi

# Scenarios: at least three, each with a result, a mismatch points at a finding.
nS=$(count "$scen" '^S[0-9]+ ')
[ "$nS" -ge 3 ] || problems+=("only $nS scenarios: dry-run at least three (normal, boundary, combination of rules or repeated action)")
h=$(hv scenarios); [ -z "$h" ] || [ "$h" = "$nS" ] || problems+=("Review line says $h scenarios, the section has $nS")
printf '%s\n' "$scen" | grep -E '^S[0-9]+ ' | grep -Evq '(MATCH|MISMATCH)' && problems+=('a scenario line has neither MATCH nor MISMATCH at its end')
printf '%s\n' "$scen" | grep -E '^S[0-9]+ ' | grep -E 'MISMATCH' | grep -Evq 'finding [0-9]+' && problems+=('a MISMATCH scenario does not point at a finding ("MISMATCH → finding N")')
printf '%s\n' "$scen" | grep -E '^S[0-9]+ ' | grep -Evq 'task expects:.*system gives:' && problems+=('a scenario line lacks "task expects: ... | system gives: ..."')

# Existing logic must cite code when a repository is connected.
if ! grep -Eiq '^Repo/mode:.*no repository' "$f"; then
  printf '%s\n' "$logic" | grep -Eq '[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:[0-9]+' || problems+=('"## Existing logic" has no file:line: a repository is connected, so the existing rules must be cited from the code')
fi

# Every requirement is accounted for: in a finding or in "Checked and consistent".
for id in $(printf '%s\n' "$reqs" | grep -Eo '^R[0-9]+' | sort -u); do
  if ! { printf '%s\n' "$finds" | grep -Eq "^Requirement:.*\b$id\b"; } && ! { printf '%s\n' "$clean" | grep -Eq "^- $id\b"; }; then
    unacc+=("$id")
  fi
done
if [ ${#unacc[@]} -gt 0 ]; then problems+=("requirement(s) not accounted for in a finding or in \"Checked and consistent\": ${unacc[*]}"); fi

# Verdict follows from the findings.
st=$(printf '%s\n' "$verdict" | grep -Eo 'STATUS: (TASK OK|NEEDS REWORK|BLOCKED)' | head -1)
if [ -z "$st" ]; then problems+=('missing verdict "STATUS: TASK OK | NEEDS REWORK | BLOCKED" in "## Verdict"'); else
  crit=$(count "$finds" '^[0-9]+\. \[[A-Za-z ]+\] \[Critical\]')
  maj=$(count "$finds" '^[0-9]+\. \[[A-Za-z ]+\] \[Major\]')
  imp=$(count "$finds" '^[0-9]+\. \[Impossible\] \[Critical\]')
  case "$st" in
    *'TASK OK') { [ "$crit" -eq 0 ] && [ "$maj" -eq 0 ]; } || problems+=("verdict TASK OK, but there are $crit Critical and $maj Major findings") ;;
    *'NEEDS REWORK') [ $((crit + maj)) -ge 1 ] || problems+=('verdict NEEDS REWORK needs at least one Major or Critical finding') ;;
    *'BLOCKED') [ "$imp" -ge 1 ] || problems+=('verdict BLOCKED needs an [Impossible] [Critical] finding') ;;
  esac
fi

chars=$(wc -c < "$f")
[ "$chars" -ge 500 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "STATIC OK"; exit 0; fi
echo "STATIC ODRZUCONY"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
