# npm preview distribution

Status: `0.2.0-preview.2` is prepared for registry publication; publication and
registry reinstallation are not yet claimed. The existing Git preview remains
available. The npm package name is `@tegg/markdown`, subject to verified scope access.

After publication is confirmed, install the exact preview version:

```sh
npm install --save-exact @tegg/markdown@0.2.0-preview.2
```

The `preview` dist-tag is for pre-release discovery. Keep the exact version and
lockfile for production reproducibility; this release does not promote a stable
`latest` version. Import Reader/Editor and their CSS as described in
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

The registry candidate includes follow-up Mermaid, React layout, type-resolution,
command discovery and localization fixes, with its own regression evidence. Real OS IME,
assistive technology and full browser product/version coverage remain separately
scoped in [validation](validation.md). npm distribution adds no platform certification.
