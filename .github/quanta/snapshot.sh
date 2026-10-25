#!/usr/bin/env bash
# Publishes the checked-out tree of quanta-wa to the public fork as one commit by the release bot,
# tagged quanta-<upstream release>-rc.<n>, which builds the staging candidate's images there
# (.github/workflows/quanta-images.yml). From main the commit also extends the fork's `quanta`
# branch; from any other branch it is reachable by its tag only. None of quanta-wa's own commits
# is ever an ancestor of it, so only this tree is published.
#   PUBLIC_FORK_DEPLOY_KEY  write deploy key of the public fork
#   SOURCE_REF              the branch built
set -euo pipefail
public=git@github.com:Quanta-Educational-Platform/workadventure.git
ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
printf '%s\n' "$PUBLIC_FORK_DEPLOY_KEY" > "$ssh_dir/key"
chmod 600 "$ssh_dir/key"
echo "github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl" > "$ssh_dir/known_hosts"
export GIT_SSH_COMMAND="ssh -i $ssh_dir/key -o IdentitiesOnly=yes -o UserKnownHostsFile=$ssh_dir/known_hosts"

base=$(git describe --tags --abbrev=0 --match 'v[0-9]*' HEAD)
# The base becomes a parent of the public commit, so everything behind it is published: it must be
# upstream's own release, never a tag someone made here on one of our commits.
upstream=$(git ls-remote https://github.com/workadventure/workadventure "refs/tags/$base" "refs/tags/$base^{}" |
  awk -v t="refs/tags/$base" '$2 == t "^{}" { peeled = $1 } $2 == t { plain = $1 } END { print peeled ? peeled : plain }')
[ -n "$upstream" ] && [ "$upstream" = "$(git rev-parse "$base^{commit}")" ] || { echo "$base is not upstream WorkAdventure's $base" >&2; exit 1; }
git fetch --quiet --no-tags "$public" "+refs/tags/quanta-*:refs/tags/quanta-*"
has_branch=$(git ls-remote --heads "$public" quanta | wc -l)
[ "$has_branch" -eq 0 ] || git fetch --quiet --no-tags "$public" "+refs/heads/quanta:refs/remotes/public/quanta"

last=$(git tag -l "quanta-$base-rc.*" | sed 's/.*-rc\.//' | sort -n | tail -1)
tag="quanta-$base-rc.$(( ${last:-0} + 1 ))"
parents=()
if [ "$has_branch" -ne 0 ]; then
  parents+=(-p "$(git rev-parse refs/remotes/public/quanta)")
  # The first snapshot on a new upstream release descends from that release too, so
  # `git diff <release> <tag>` on the fork shows exactly Quanta's changes.
  git merge-base --is-ancestor "$base" refs/remotes/public/quanta || parents+=(-p "$(git rev-parse "$base^{commit}")")
else
  parents+=(-p "$(git rev-parse "$base^{commit}")")
fi
commit=$(GIT_AUTHOR_NAME="Quanta release bot" GIT_AUTHOR_EMAIL="noreply@quanta.world" \
  GIT_COMMITTER_NAME="Quanta release bot" GIT_COMMITTER_EMAIL="noreply@quanta.world" \
  git commit-tree "$(git rev-parse 'HEAD^{tree}')" "${parents[@]}" -m "Quanta $tag" -m "WorkAdventure $base with Quanta's changes, built from $SOURCE_REF.")
git tag "$tag" "$commit"
refs=("refs/tags/$tag")
[ "$SOURCE_REF" != main ] || refs+=("$commit:refs/heads/quanta")
# All or nothing: a tag without its branch update would build images for a snapshot main never got.
git push --quiet --atomic "$public" "${refs[@]}"
echo "Published $tag ($SOURCE_REF): the images build in the public fork's Actions." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
