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

7. Read the actual registry dist-tags after publishing. A first publication may
   also acquire `latest`; report the actual result and do not call a pre-release stable.
8. Create a GitHub pre-release for the exact source commit used to build the package.
   Attach the reviewed tarball and its integrity manifest; do not rebuild a different
   archive under the published version. Keep existing tags immutable.
9. Update README, getting started, integration update, changelog and validation
   together. Separate current package results from historical native/performance evidence.

`0.2.0-preview.2` is published. See [npm release status](npm-release.md).
Later documentation commits do not retroactively change the published tarball.
CI checks a newly packed checkout; its artifact is not proof that that checkout
was published. Use the recorded registry integrity to identify the actual release.

License changes affect new grants only. Never claim to revoke rights already
granted under an earlier license. Keep old releases and their original terms
identifiable. Custom and commercial terms have not been independently reviewed
by external counsel; do not claim a legal certification.

## Repository ownership and daily Git workflow

This repository is the only writable source of the shared SDK. Consumer
applications own their platform adapters, permissions, persistence and product UI;
they consume a tested immutable SDK identity and do not copy a second core.
Customer-specific data and private application history never enter this repo.

1. Check Git root, branch, status and origin. Use a short `codex/<task>` branch
   from current main, preserving unrelated changes. Never switch remotes to make
   an unrelated checkout match the task.
2. Implement generic changes here with core tests. Keep application-specific
   adaptations in the consumer's own repository. Record separate validation.
3. Run `npm run check`. Package changes also run `npm run check:consumers` and
   `npm run test:browser`, against the freshly built archive, before merging.
4. Stage named files, inspect the staged diff, and use a behavior-focused public
   commit description. Exclude customer identities, local machine paths and
   private planning. Use a PR into main and wait for required checks.
5. Push and merge only within the user's authorized scope. Publishing npm or a
   release needs its own applicable authorization; source cleanup does not change
   the already published version. Never force-push or move an existing tag during
   routine maintenance.

The next npm archive contains built runtime/types/styles, licenses, text guides,
small evidence manifests and selected integration examples. Source and tests stay
in Git; large illustration images are linked from the attribution guide. The
package inventory check rejects source/test payloads and private application
files. Git dependency preparation still builds from the full Git checkout.
The published preview.2 archive is immutable and retains its original contents.
