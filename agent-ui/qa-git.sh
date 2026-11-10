#!/usr/bin/env bash
# Tylko-do-odczytu opakowanie git dla agentów QA. Nie ma tu żadnej ścieżki zapisu do zdalnego repo:
# brak push/commit/merge/checkout/reset/rebase/tag/branch/config, a `fetch` aktualizuje wyłącznie lokalny cache w ~/qa/repos.
#
#   qa-git.sh prepare <repo> <TICKET[,TICKET2,...]> <WORK_DIR> [<commit>]   kroki 2-3 z CLAUDE.md (klon --no-checkout gdy brak, fetch, tryb, diff);
#                                                    <commit> = merge/commit zmiany, gdy nie nosi klucza ticketu (tryb static mimo zmiany)
#   qa-git.sh find <regex>                           w którym repo (cache ~/qa/repos) siedzi dany termin: treść kodu na bazie i komunikaty commitów
#   qa-git.sh git [-C <dir>] <podkomenda> ...       przepuszcza WYŁĄCZNIE podkomendy odczytu
set -euo pipefail

QA_ROOT="$HOME/qa/repos"
MCP_LOCAL="$HOME/qa/local/mcp-server"
GIT_HOST="git.example.internal"
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_qa -o BatchMode=yes"
export GIT_TERMINAL_PROMPT=0

READ_ONLY=" fetch ls-remote diff log show show-ref cat-file for-each-ref ls-tree rev-parse rev-list merge-base grep blame "

die() { echo "qa-git: $*" >&2; exit 2; }

allowed_dir() {
  local d; d="$(cd "$1" 2>/dev/null && pwd)" || die "brak katalogu: $1"
  case "$d" in "$QA_ROOT"/*|"$MCP_LOCAL") ;; *) die "katalog poza dozwolonymi repozytoriami: $d" ;; esac
}

safe_git() {
  local dir=""
  if [ "${1:-}" = "-C" ]; then dir="$2"; shift 2; allowed_dir "$dir"; fi
  local sub="${1:-}"; [ -n "$sub" ] || die "brak podkomendy"; shift
  case "$READ_ONLY" in *" $sub "*) ;; *) die "podkomenda zabroniona (tylko odczyt): $sub" ;; esac
  for a in "$@"; do
    case "$a" in
      --output|--output=*|-c|--upload-pack*|--receive-pack*|--exec*|--ext-diff|--textconv|--open-files-in-pager*)
        die "opcja zabroniona: $a" ;;
    esac
  done
  if [ -n "$dir" ]; then exec git -C "$dir" "$sub" "$@"; else exec git "$sub" "$@"; fi
}

group_for() {
  case "$1" in
    svc-*) echo "platform/svc" ;;
    core-*) echo "platform/core" ;;
    plat-*|fix-*) echo "platform" ;;
    *) die "nieznana grupa GitLab dla repo: $1 (dodaj do group_for)" ;;
  esac
}

prepare() {
  local repo="$1" tickets="$2" work="$3" ref="${4:-}"
  [ -z "$ref" ] || [[ "$ref" =~ ^[0-9a-f]{7,40}$ ]] || die "niepoprawny commit: $ref"
  [[ "$repo" =~ ^[a-z0-9._-]+$ ]] || die "niepoprawna nazwa repo"
  # Jeden klucz albo lista po przecinku (np. ticket nadrzędny + podzadania Backend/Frontend):
  # merge i gałąź noszą zwykle klucz PODZADANIA, więc samo PRJ-615 nie znajdzie zmiany z PRJ-616.
  local -a keys; IFS=',' read -r -a keys <<< "$tickets"
  local k; for k in "${keys[@]}"; do [[ "$k" =~ ^[A-Z][A-Z0-9]*-[0-9]+$ ]] || die "niepoprawny klucz ticketu: $k"; done
  local ticket="${keys[0]}" keyre; keyre=$(IFS='|'; echo "${keys[*]}")
  mkdir -p "$work"
  local dir
  if [ "$repo" = "mcp-server" ]; then dir="$MCP_LOCAL"
  else
    dir="$QA_ROOT/$repo"
    if [ ! -d "$dir/.git" ]; then
      mkdir -p "$QA_ROOT"
      git clone --no-checkout "git@$GIT_HOST:$(group_for "$repo")/$repo.git" "$dir" >&2
    fi
  fi
  git -C "$dir" fetch origin --prune >&2

  local base=develop
  git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$base" || base=main
  git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$base" || base=master

  local branch mode range="" m after before=""
  branch=$(git -C "$dir" for-each-ref --format='%(refname:short)' refs/remotes/origin \
    | sed 's|^origin/||' | grep -vxE 'HEAD' | grep -E "(^|[-_/])($keyre)([-_/]|$)" | head -n1 || true)
  if [ -n "$ref" ]; then
    # Zmiana wskazana wprost (merge albo commit bez klucza w nazwie, np. "Merge branch 'feature/lp_reject_cooldown'").
    git -C "$dir" cat-file -e "$ref^{commit}" 2>/dev/null || die "nie ma commita $ref w $repo"
    mode=whitebox; range="$ref^1 $ref"; after="$ref"; before="$ref^1"
  elif [ -n "$branch" ]; then
    mode=whitebox; range="origin/$base...origin/$branch"
    after="origin/$branch"; before=$(git -C "$dir" merge-base "origin/$base" "origin/$branch")
  else
    local -a greps=(); for k in "${keys[@]}"; do greps+=(--grep="$k"); done
    m=$(git -C "$dir" log "origin/$base" --merges "${greps[@]}" -n1 --format=%H || true)
    # Squash albo zwykły commit z kluczem w komunikacie ("Resolve PRJ-524 ...") — bez merge commita.
    [ -n "$m" ] || m=$(git -C "$dir" log "origin/$base" --no-merges "${greps[@]}" -n1 --format=%H || true)
    if [ -n "$m" ]; then mode=whitebox; range="$m^1 $m"; after="$m"; before="$m^1"
    else mode=static; after="origin/$base"; fi
  fi
  # Drugie repo w tym samym WORK_DIR (np. backend + frontend) dostaje własne katalogi, zamiast nadpisać kod-po pierwszego.
  local sfx="" owner="$work/.kod-po-repo"
  if [ -f "$owner" ] && [ "$(cat "$owner")" != "$repo" ]; then sfx="-$repo"; else echo "$repo" > "$owner"; fi
  echo "TICKETS=$tickets"; echo "REPO_DIR=$dir"; echo "BASE=$base"; echo "BRANCH=${branch:-}"; echo "MODE=$mode"; echo "RANGE=$range"
  if [ -n "$range" ]; then
    # shellcheck disable=SC2086
    git -C "$dir" diff $range > "$work/$ticket$sfx.diff"
    echo "DIFF=$work/$ticket$sfx.diff"
  fi

  # Migawki kodu jako zwykłe pliki — agenci czytają je Read/Grep/Glob, bez Bash.
  # Treść bajt w bajt jak w gicie, więc numery linii z Read są prawdziwymi numerami w pliku.
  snapshot() { # <ref> <katalog>
    rm -rf "$2"; mkdir -p "$2"
    git -C "$dir" -c core.autocrlf=false -c core.eol=lf archive --format=tar "$1" | tar -x -C "$2"
  }
  snapshot "$after" "$work/kod-po$sfx"
  echo "KOD_PO=$work/kod-po$sfx"
  if [ -n "$before" ]; then snapshot "$before" "$work/kod-przed$sfx"; echo "KOD_PRZED=$work/kod-przed$sfx"; fi

  if [ -n "$range" ]; then echo "--- stat"; git -C "$dir" diff --stat $range; fi
}

find_code() {
  local re="$1" d repo base hits n log
  [ -n "$re" ] || die "użycie: find <regex>"
  [ -d "$QA_ROOT" ] || die "brak cache repozytoriów: $QA_ROOT"
  echo "Szukam /$re/ (bez uwzględniania wielkości liter) w lokalnym cache repo, na gałęzi bazowej. Repo spoza cache nie są przeszukiwane."
  for d in "$QA_ROOT"/*/; do
    [ -d "$d/.git" ] || continue
    repo=$(basename "$d"); base=develop
    git -C "$d" show-ref --verify --quiet "refs/remotes/origin/$base" || base=main
    git -C "$d" show-ref --verify --quiet "refs/remotes/origin/$base" || base=master
    hits=$(git -C "$d" grep -lIiE -e "$re" "origin/$base" 2>/dev/null | sed "s|^origin/$base:||" || true)
    log=$(git -C "$d" log "origin/$base" -i -E --grep="$re" -n3 --format='%h %s' 2>/dev/null || true)
    [ -n "$hits" ] || [ -n "$log" ] || continue
    n=$(printf '%s
' "$hits" | grep -c . || true)
    echo "== $repo ($n plików na origin/$base)"
    printf '%s
' "$hits" | grep -viE '(^|/)(test|integrationTest|spec)/|\.spec\.|Test\.kt$' | head -n 6 | sed 's/^/   /'
    [ -n "$log" ] && printf '%s
' "$log" | sed 's/^/   commit: /'
  done
}

case "${1:-}" in
  find) [ $# -eq 2 ] || die "użycie: find <regex>"; find_code "$2" ;;
  prepare) { [ $# -eq 4 ] || [ $# -eq 5 ]; } || die "użycie: prepare <repo> <TICKET[,TICKET2]> <WORK_DIR> [<commit>]"; prepare "$2" "$3" "$4" "${5:-}" ;;
  git) shift; safe_git "$@" ;;
  *) die "użycie: prepare <repo> <TICKET> <WORK_DIR> | find <regex> | git [-C dir] <podkomenda odczytu> ..." ;;
esac
