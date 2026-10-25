# WorkAdventure for Quanta

This is the source of the WorkAdventure that runs Quanta's virtual rooms: an upstream WorkAdventure
release with Quanta's changes, published under WorkAdventure's licence (see `LICENSE.txt` in each
package).

- `quanta-<release>-q<n>` tags: what runs in production. `git diff <release> quanta-<release>-q<n>`
  shows Quanta's changes to that upstream release.
- `quanta-<release>-rc.<n>` tags: candidates tried on staging; the `quanta` branch follows them.
- Images: `ghcr.io/quanta-educational-platform/wa-{play,back,map-storage}`, built from these tags by
  `.github/workflows/quanta-images.yml`, with build provenance attested.

Changes are made elsewhere and published here by a release bot; pull requests here aren't merged.
