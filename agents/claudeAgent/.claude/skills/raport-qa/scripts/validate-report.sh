#!/usr/bin/env bash
# Checks the structure of a report. Prints "RAPORT OK" or "RAPORT ODRZUCONY" with the list of problems.
f=""
while [ $# -gt 0 ]; do case "$1" in --report) f="$2"; shift 2;; *) [ -f "$1" ] && f="$1"; shift;; esac; done
[ -n "$f" ] && [ -f "$f" ] || { echo "RAPORT ODRZUCONY"; echo "- report file not found: $f"; exit 1; }
problems=()
need() { grep -Eiq "$1" "$f" || problems+=("$2"); }

head -1 "$f" | grep -Eq '^[A-Z][A-Z0-9]*-[0-9]+' || problems+=("the first line must be the ticket key, or NOTICKET-0")
if ! grep -Eiq 'Brak krytycznych przypadk' "$f"; then
  need '^1\. ' 'no numbered finding and no line "Brak krytycznych przypadków"'
  need '^Dowód:' 'a finding has no "Dowód:" line'
  need '^Ścieżka do replikacji:' 'a finding has no "Ścieżka do replikacji:" line'
fi
chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "RAPORT OK"; exit 0; fi
echo "RAPORT ODRZUCONY"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
