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
chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "PROJEKT OK"; exit 0; fi
echo "PROJEKT ODRZUCONY"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
