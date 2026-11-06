#!/bin/bash
# Release notes from the pull requests merged into main, grouped by the
# backlog feature of their story (the US-x.y in the PR title):
#
#   scripts/changelog.sh [<since> [<until>]]
#
# <since> defaults to the latest tag before <until> (or the first commit),
# <until> to HEAD. Writes Markdown to stdout.
set -euo pipefail

cd "$(dirname "$0")/.."
until_ref=${2:-HEAD}
since_ref=${1:-$(git describe --tags --abbrev=0 "$until_ref^" 2>/dev/null || true)}
range=${since_ref:+$since_ref..}$until_ref
repo_url=https://github.com/MauriLan91/designtree

# "US-12.1<TAB>F12 Packaging and updates", from the backlog's feature tables.
stories=$(awk '
	/^### F[0-9]+ / { feature = substr($0, 5) }
	/^## / { feature = "" }
	feature != "" && /^\| US-[0-9]+\.[0-9]+ / { split($0, cell, "|"); gsub(/ /, "", cell[2]); print cell[2] "\t" feature }
' docs/backlog.md)

# One line per merged PR: "<feature or ~>\t<title> (#N)". Merge commits of
# PRs carry the PR title as their body.
entries=$(git log --merges --first-parent --reverse --format='%s%x1f%b%x1e' "$range" |
	awk -v RS='\x1e' -F '\x1f' -v stories="$stories" -v url="$repo_url" '
		BEGIN {
			n = split(stories, rows, "\n")
			for (i = 1; i <= n; i++) { split(rows[i], kv, "\t"); feature[kv[1]] = kv[2] }
		}
		{
			sub(/^\n+/, "", $1)
			if (!match($1, /^Merge pull request #[0-9]+/)) next
			pr = substr($1, 21, RLENGTH - 20)
			title = $2
			sub(/\n.*/, "", title)
			if (title == "") next
			group = "~"
			if (match(title, /US-[0-9]+\.[0-9]+/)) {
				id = substr(title, RSTART, RLENGTH)
				if (id in feature) group = feature[id]
			}
			print group "\t" title " ([#" pr "](" url "/pull/" pr "))"
		}')

if [ -z "$entries" ]; then
	echo "No pull requests merged in $range."
	exit 0
fi

# Features in backlog order, then changes outside any story.
order=$(printf '%s\n' "$stories" | cut -f2 | awk '!seen[$0]++')
order=$order$'\n~'
while IFS= read -r group; do
	lines=$(printf '%s\n' "$entries" | awk -F '\t' -v g="$group" '$1 == g { print "- " $2 }')
	[ -n "$lines" ] || continue
	if [ "$group" = "~" ]; then
		printf '### Other changes\n\n%s\n\n' "$lines"
	else
		printf '### %s\n\n%s\n\n' "$group" "$lines"
	fi
done <<<"$order"
