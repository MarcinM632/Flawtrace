#!/usr/bin/env bash
# Checks the entry of phase 7. Prints "WYJAŚNIONO OK" or "WYJAŚNIONO ODRZUCONE" with the list of problems.
f=""
while [ $# -gt 0 ]; do case "$1" in --report) f="$2"; shift 2;; *) [ -f "$1" ] && f="$1"; shift;; esac; done
[ -n "$f" ] && [ -f "$f" ] || { echo "WYJAŚNIONO ODRZUCONE"; echo "- entry file not found: $f"; exit 1; }
problems=()
need() { grep -Eq "$1" "$f" || problems+=("$2"); }

head -1 "$f" | grep -Eq '^[A-Za-z0-9_-]+ — .+' || problems+=('first line must be "<KEY> — <short title>"')
need '^Co to jest:' 'missing "Co to jest:"'
need '^Dlaczego tak:' 'missing "Dlaczego tak:"'
need '^Jak to działa w praktyce:' 'missing "Jak to działa w praktyce:"'
need '^Stan testów: .*[0-9]|^Stan testów: no phase reports in the input' '"Stan testów:" needs numbers from the phase reports, or "no phase reports in the input"'
need '^Znane defekty tego obszaru:' 'missing "Znane defekty tego obszaru:"'
need '^Źródła:' 'missing "Źródła:"'

chars=$(wc -m < "$f")
[ "$chars" -le 3000 ] || problems+=("entry is $chars characters, hard limit is 3000 (target 2000)")

grep -Eq '^\s*\||\*\*' "$f" && problems+=("tables and bold are not allowed")
grep -Eq '^\s+[-*] ' "$f" && problems+=("nested lists are not allowed")

# defects: either the "none" line or flat entries "- KEY: sentence [severity; certainty]"
defs=$(sed -n '/^Znane defekty tego obszaru:/,/^\(Nie jest defektem:\|Źródła:\)/p' "$f" | sed '1d;$d' | grep -v '^\s*$')
if ! echo "$defs" | grep -Fq 'Brak znanych defektów tego obszaru w rejestrze'; then
  [ -n "$defs" ] || problems+=("the defect list is empty; write the entries or the line \"Brak znanych defektów tego obszaru w rejestrze\"")
  while IFS= read -r l; do
    [ -z "$l" ] && continue
    echo "$l" | grep -Eq '^Oraz [0-9]+ ' && continue
    echo "$l" | grep -Eq '^- (new|[A-Z][A-Z0-9]*-[0-9]+(, ?[A-Z][A-Z0-9]*-[0-9]+)*|bug:[A-Za-z0-9-]+): .+ \[(critical|high|medium|low|not assessed); (confirmed|reported|suspected)\]$' \
      || problems+=("defect entry not in the form \"- KEY: sentence [severity; certainty]\": ${l:0:70}")
  done <<< "$defs"
fi

# long sentences
long=$(sed -E 's/([.!?]) +/\1\n/g' "$f" | awk 'NF>35{c++} END{print c+0}')
[ "$long" -eq 0 ] || problems+=("$long sentence(s) longer than 35 words")

if [ ${#problems[@]} -eq 0 ]; then
  [ "$chars" -le 2000 ] || echo "NOTE: $chars characters; the target is 2000"
  echo "WYJAŚNIONO OK"; exit 0
fi
echo "WYJAŚNIONO ODRZUCONE"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
