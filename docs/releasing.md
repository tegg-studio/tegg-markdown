# Git and release process

The canonical repository is https://github.com/tegg-studio/tegg-markdown.
Use main plus short task branches. Before merging: inspect the exact diff,
run npm ci and npm run check, verify packaged installation in an independent
Host, and review any dependency/license changes. Accept external code only after
the explicit contributor grant in CLA.md is recorded.

The initial public history contains a curated core snapshot and SDK adaptations,
not the private application history. docs/extraction-manifest.json records the
source commit and hashes before adaptations.

Applications should consume an exact tested package version or immutable artifact.
Tegg Notes consumes the shared dependency with a separately recorded native regression
scope. See [validation](validation.md); SDK publication alone is not evidence of
complete application or platform acceptance.
Avoid maintaining two writable canonical copies. Shared-core changes belong here
and then flow into applications through a version update.

## Before an npm release

1. Confirm registry scope/name ownership and the intended public version.
2. Rebuild full third-party notices from the exact lockfile and inspect embedded assets.
3. Run unit, type, package, browser and claimed target-platform checks.
4. Review LICENSE, attribution examples, distribution inventory and secrets scan.
5. Generate a packed artifact and record its integrity and validation evidence.
6. With registry publication authorization, publish the exact reviewed tarball with
   `--ignore-scripts --access public --tag preview`, so publishing cannot rebuild it.
   Verify registry integrity and independent registry consumers before reporting
   success. Keep existing Git tags immutable; record the new release commit.

The current candidate has explicit publishConfig for the official registry, public
access and the preview dist-tag. See [npm release status](npm-release.md).

License changes affect new grants only. Never claim to revoke rights already
granted under an earlier license. Keep old releases and their original terms
identifiable. Custom and commercial terms have not been independently reviewed
by external counsel; do not claim a legal certification.
