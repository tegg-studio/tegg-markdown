# npm preview distribution

Status: `@tegg/markdown@0.2.0-preview.2` was published on the official npm
registry on 2026-09-14. This remains a preview release.

Install the exact preview version:

```sh
npm install --save-exact @tegg/markdown@0.2.0-preview.2
```

The `preview` dist-tag is for pre-release discovery. Keep the exact version and
lockfile for production reproducibility. This is not a stable release. Import Reader/Editor and their CSS as described in
[getting started](getting-started.md); configure optional engines explicitly.

The npm artifact retains the custom Attribution License, required visible
**Powered by Tegg Markdown**, third-party notices and applicable license files.
Publishing on npm does not change the source-available licensing terms.

## Publication checks

1. Authenticate against the official npm registry and verify scope publish access.
2. Build and validate a clean release commit, including independent tarball consumers.
3. Inspect package contents and record the exact tarball integrity.
4. Publish that tarball with public access and the `preview` dist-tag.
5. Compare registry integrity, reinstall the exact registry version in independent
   consumers, and repeat their type/build/browser checks.
6. Record the registry result and immutable Git identity; never move an existing tag.

The published version includes follow-up Mermaid, React layout, type-resolution,
command discovery and localization fixes, with its own regression evidence. Real OS IME,
assistive technology and full browser product/version coverage remain separately
scoped in [validation](validation.md). npm distribution adds no platform certification.

## Published artifact

The registry integrity matches the independently tested tarball:

```text
sha512-/m1NW4TUPenpZfg0RMRIjcDOsb5mH20hgKeKf2EE85o1/JmyAsw0LcHy2jQSQViN+T78PHDwp4xeYU9ciLlStg==
```

The package was built from `6d03f9457768283e16113d870d25175bc918e730`.
The merged main commit `d6a3409e8481ec77fdfd409130348098e8715d0c` has the same
source tree. Later documentation updates do not change this immutable package.
The included README records the pre-publication checkpoint; this repository page
is the current publication record. Existing Git tags remain unchanged.

Registry reinstallation passed in four independent consumers: vanilla, React 18,
React 19 and optional engines. Both TypeScript resolution strategies and production
builds passed; all 21 installed JS/CSS hashes match the validated package. The
registry-installed builds passed all 49 Chromium/Firefox/WebKit integration checks.

Registry tag note: the first publication also acquired a `latest` tag. A standard
CLI attempt to remove it returned HTTP 400; the verified registry currently lists
both `preview` and `latest` at this pre-release. Use the exact version above; the
registry alias does not establish a stable-release commitment.
