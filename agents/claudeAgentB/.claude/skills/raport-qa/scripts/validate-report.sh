#!/usr/bin/env bash
# Checks the structure and the completeness of a report. Prints "RAPORT OK" or "RAPORT ODRZUCONY" with the list of problems.
# Completeness: the header counts, the integration and outside-the-change lines, evidence with file:line, and every file of the
# diff (WORK_DIR/*.diff, the folder of the report) accounted for by name.
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
  # Every numbered finding needs its own evidence line with a real file:line.
  nf=$(grep -Ec '^[0-9]+\. ' "$f")
  nd=$(grep -Ec '^Dowód:' "$f")
  [ "$nd" -ge "$nf" ] || problems+=("$nf numbered findings but only $nd \"Dowód:\" lines: every finding needs its own evidence")
fi
if grep -Eq '^Dowód:' "$f" && grep -E '^Dowód:' "$f" | grep -Evq '[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:[0-9]+'; then
  problems+=('a "Dowód:" line has no file:line (for example src/main/Rule.kt:88)')
fi

# Header: the counts that show how far the analysis went.
hdr=$(grep -Em1 '^whitebox:' "$f" || true)
if [ -z "$hdr" ]; then
  problems+=('missing header line "whitebox: <n files read> | diff: <n lines> | mode: <whitebox|static> | repos: <n> | contacts: <n> | callers: <n>"')
else
  for k in diff mode repos contacts callers edge maps reqs; do
    printf '%s' "$hdr" | grep -Eiq "\| *$k:" || problems+=("the whitebox header has no \"$k:\" field")
  done
fi

printf '%s' "$hdr" | grep -Eiq '\| *reqs: *[0-9]+/[0-9]+' || problems+=('the "reqs:" field must be <implemented>/<total>, for example reqs: 4/5')

# Consequence of every finding: the fixed structure of "Dlaczego to groźne:".
if ! grep -Eiq 'Brak krytycznych przypadk' "$f"; then
  nf2=$(grep -Ec '^[0-9]+\. ' "$f")
  for lab in 'Dotkliwość' 'Wykrywalność' 'Pewność'; do
    nl=$(grep -Ec "^Dlaczego to groźne:.*$lab:" "$f" || true)
    [ "$nl" -ge "$nf2" ] || problems+=("$nf2 numbered findings but only $nl \"Dlaczego to groźne:\" lines with \"$lab:\": every finding needs trigger, result, who, detectability, severity and confidence")
  done
  if grep -E '^Dlaczego to groźne:' "$f" | grep -Evq 'Dotkliwość: *(krytyczna|wysoka|średnia|niska)'; then
    problems+=('"Dotkliwość:" must be one of: krytyczna, wysoka, średnia, niska')
  fi
  if grep -E '^Dlaczego to groźne:' "$f" | grep -Evq 'Pewność: *(potwierdzone|założenie)'; then
    problems+=('"Pewność:" must start with "potwierdzone (src: ...)" or "założenie:"')
  fi
fi

# The three jobs: the feature, its contacts, and the rest of the system.
need '^Integracje:' 'missing line "Integracje:" (producer → consumer: result, or one sentence why nothing external changed)'
need '^Poza zmianą:' 'missing line "Poza zmianą:" (callers, shared code and unrelated hunks checked, or one sentence why none)'
need '^Sprawdzone i czyste:' 'missing line "Sprawdzone i czyste:" (file or area: what was verified)'
for k in 'Integracje' 'Poza zmianą'; do
  v=$(grep -Em1 "^$k:" "$f" | sed -E "s/^$k:[[:space:]]*//" || true)
  if [ -n "$v" ] && [ "${#v}" -lt 25 ]; then problems+=("\"$k:\" is too short to show what was checked (${#v} characters)"); fi
done

# Work files of the skills (edge-cases, mapping-check, missing-handling) exist in the folder of the report.
wd=$(dirname "$f")
for w in edge-cases.md mapping.md trace.md; do
  if [ ! -f "$wd/$w" ]; then problems+=("$w is missing in the work folder: load the matching skill and write it (one line saying why is enough when nothing applies)")
  elif [ "$(wc -c < "$wd/$w")" -lt 40 ]; then problems+=("$w is empty: write the table, or one line saying why nothing applies")
  fi
done

# Every changed file of the diff is accounted for by name (a finding or "Sprawdzone i czyste").
missing=()
files_in_diff=0
for d in "$wd"/*.diff; do
  [ -f "$d" ] || continue
  while IFS= read -r p; do
    case "$p" in
      *package-lock.json|*yarn.lock|*pnpm-lock.yaml|*.lock|*.png|*.jpg|*.jpeg|*.gif|*.svg|*.ico|*.woff|*.woff2|*.min.js|*.min.css|*.map|*.snap) continue ;;
    esac
    files_in_diff=$((files_in_diff + 1))
    b=$(basename "$p")
    grep -Fq -- "$b" "$f" || missing+=("$p")
  done < <(grep -E '^diff --git ' "$d" | sed -E 's|^diff --git a/.* b/||')
done
if [ ${#missing[@]} -gt 0 ]; then
  shown=$(printf '%s, ' "${missing[@]:0:12}"); shown=${shown%, }
  more=""; [ ${#missing[@]} -gt 12 ] && more=" (and $(( ${#missing[@]} - 12 )) more)"
  problems+=("${#missing[@]} of $files_in_diff changed files are not accounted for by name in the report: $shown$more. Read each one and add it to a finding or to \"Sprawdzone i czyste\" with what you verified in it")
fi
# Files read must cover the changed files.
if [ -n "$hdr" ] && [ "$files_in_diff" -gt 0 ]; then
  nr=$(printf '%s' "$hdr" | sed -E 's/^whitebox:[[:space:]]*([0-9]+).*/\1/')
  case "$nr" in ''|*[!0-9]*) problems+=('the whitebox header must start with the number of files read: "whitebox: <n> | ..."') ;;
    *) [ "$nr" -ge "$files_in_diff" ] || problems+=("header says $nr files read, but the diff changes $files_in_diff: read every changed file in full") ;;
  esac
fi

chars=$(wc -c < "$f")
[ "$chars" -ge 200 ] || problems+=("the report is too short ($chars characters)")
if [ ${#problems[@]} -eq 0 ]; then echo "RAPORT OK"; exit 0; fi
echo "RAPORT ODRZUCONY"
for p in "${problems[@]}"; do echo "- $p"; done
exit 1
