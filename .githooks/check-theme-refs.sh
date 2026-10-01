#!/usr/bin/env bash
# Fails if any theme file points at an asset, snippet or section that does not
# exist. Catches the failure mode where a sync from an older copy of the theme
# (a `shopify theme dev`/`push` against the live theme, then the GitHub bot
# committing the result) deletes files that the current code still uses.
#
# Usage: .githooks/check-theme-refs.sh            (checks the working tree)
# Run automatically by the pre-commit, pre-merge-commit and post-merge hooks.

set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

missing=0
report() {
  echo "  missing $1  (referenced in $2)"
  missing=$((missing + 1))
}

liquid_files=$(find layout sections snippets blocks templates -name '*.liquid' 2>/dev/null)

# 'name.ext' | asset_url / asset_img_url / inline_asset_content  ->  assets/name.ext
# (a fragment such as '.svg' appended to a variable is not a file name, so
#  anything starting with a dot is skipped)
while IFS=: read -r file name; do
  case "$name" in .*) continue ;; esac
  [ -n "$name" ] && [ ! -f "assets/$name" ] && report "assets/$name" "$file"
done < <(grep -oHE "'[^'{}]+'[[:space:]]*\|[[:space:]]*(asset_url|asset_img_url|inline_asset_content)" $liquid_files 2>/dev/null |
  sed -E "s/^([^:]+):'([^']+)'.*/\1:\2/" | sort -u)

# render / include 'name'  ->  snippets/name.liquid
while IFS=: read -r file name; do
  [ -n "$name" ] && [ ! -f "snippets/$name.liquid" ] && report "snippets/$name.liquid" "$file"
done < <(grep -oHE "(render|include)[[:space:]]+'[^'{}]+'" $liquid_files 2>/dev/null |
  sed -E "s/^([^:]+):(render|include)[[:space:]]+'([^']+)'/\1:\3/" | sort -u)

# {% section 'name' %}  ->  sections/name.liquid
while IFS=: read -r file name; do
  [ -n "$name" ] && [ ! -f "sections/$name.liquid" ] && report "sections/$name.liquid" "$file"
done < <(grep -oHE "section[[:space:]]+'[^'{}]+'" $liquid_files 2>/dev/null |
  sed -E "s/^([^:]+):section[[:space:]]+'([^']+)'/\1:\2/" | sort -u)

# "type": "name" in JSON templates and section groups  ->  sections/name.liquid
# (block types, app blocks and anything containing a slash are skipped)
for file in templates/*.json sections/*.json; do
  [ -f "$file" ] || continue
  python3 - "$file" <<'PY' | while IFS= read -r name; do [ ! -f "sections/$name.liquid" ] && report "sections/$name.liquid" "$file"; done
import json, re, sys
raw = open(sys.argv[1]).read()
raw = re.sub(r'^\s*/\*.*?\*/', '', raw, flags=re.S)
try:
    data = json.loads(raw)
except ValueError:
    sys.exit(0)
for section in (data.get('sections') or {}).values():
    t = section.get('type', '')
    if t and '/' not in t and not t.startswith('_') and t != 'apps':
        print(t)
PY
done

if [ "$missing" -gt 0 ]; then
  echo
  echo "Theme reference check failed: $missing referenced file(s) do not exist."
  echo "Something deleted files the theme still uses. Restore them before committing,"
  echo "e.g.  git checkout <last-good-commit> -- <path>"
  exit 1
fi
echo "Theme reference check passed."
