# Changelog

## 0.3.0-preview.1 — development candidate, not published

- Disable native text correction, capitalization and autofill in literal search and
  object draft fields so WebKit blur cannot silently change Markdown or replacements.

- Add shared source-bound editing sessions, optional editing UI, literal search and
  replacement, profile-aware local object drafts and bounded Host extensions.
- Add offline clipboard review, persistent attachment tasks, native picker hooks,
  and complete GFM table operations with rectangular copy/paste and mobile controls.
- Add exact saved-snapshot verification, checksummed recovery journals, bounded
  three-version reconciliation and a shared conflict review UI.
- Preserve BOM and uniform LF/CRLF source, protect unsupported newline mixtures,
  and reject Unicode-splitting patches.
- Bound large-document previews and toolbar parsing; cache immutable analyses and
  index dense object ranges while retaining full rebuilds for syntax changes.
- Add packed vanilla/React examples, browser attachment storage workflows, source
  fidelity fixtures and recovery/accessibility verification gates.

This candidate is prepared for Draft PR review. No registry publication or release
is implied. Existing required attribution and commercial licensing are unchanged.

## Previous repository cleanup (unreleased at the time)

- Limit npm archives to runtime files, declarations, legal materials and selected guides/examples. Keep source, tests and large illustrations in Git.
- Enforce package inventory and public repository boundaries, and document the contributor Git workflow.
- No SDK API/runtime change or new npm publication is included in this cleanup.

## 0.2.0-preview.2 — npm preview (2026-09-14)

- Prepare public registry distribution under the `preview` dist-tag.
- Preserve the attribution license and source-first native integration.
- Retain safe Mermaid animation styles while blocking external resource CSS.
- Fix React mount height propagation and localize table quantity labels.
- Add legacy TypeScript subpath mappings and profile-aware command discovery.
- Provide a compiled React toolbar reference and Mermaid version/color CI.
- Include the completed native validation record and registry installation guidance.

Published on the official npm registry; its integrity matches the tested tarball.

## 0.2.0-preview.1 — Git preview, not a registry release

- Keep unresolved reference brackets visible in Live Edit and apply the selected
  profile to link navigation. Avoid toolbar/outline work without Host subscribers.
- Add explicit Tegg, GitHub and GFM syntax profiles with fixed normative fixtures.
- Add lightweight Reader/Editor, React 18/19 adapters, instance engines and read-only
  renderer slots with cleanup, cancellation and Context-preserving portals.
- Make resource loading opt-in, including resolved URLs; add source selection hooks,
  locale/messages, Host layout and isolated overlay support.
- Add optional offline GeoJSON/TopoJSON/ASCII STL previews with input budgets.
- Coalesce subsequent streaming snapshots, retain independent blocks/unchanged
  renderer instances, update late references and preserve reading position.
- Add independent packed consumers, browser/CSP/accessibility/streaming checks and
  a local atomic revision comparison example.

Read [migration](docs/migration.md) before upgrading. Final verification and publication
identities are recorded in [validation](docs/validation.md), not inferred from this list.

## 0.1.0-preview.2

- Align the default SDK and example accent with the Mac Host system blue (#007AFF), including controls, links, task checkboxes and 12% selection fills.

- Add toolbar state, versioned outlines, heading/fragment navigation, instance appearance and source-visible accessibility controls.
- Allow native Hosts to supply callout menus with stale-response protection.
- Add the advanced `@tegg/markdown/core` entry for existing native adapters.
- Replace the minimal two-pane example with a document workspace, formatting controls, outline, file import/export and draft protection.
- Scope link popovers to their editor instance and preserve independent widget input focus.
- Keep the attribution license and default visible credit unchanged.


## Historical fixes before 0.2

- Fix duplicate table-cell commits when Enter is followed by blur; preserve the
  edited value and a single undo step.

## 0.1.0-preview.1

- Establish an independent source-available Markdown core repository.
- Add a Host-neutral Reader and three-mode Editor API, versioned save
  acknowledgement, dirty-draft conflict protection and instance resource context.
- Display required attribution separately from user content.
- Include the Tegg Markdown Attribution License 1.0, commercial white-label
  policy, contributor agreement and preserved third-party notices.
- Import the existing core rendering/editing tests and add SDK contract coverage.

This is the first public repository preview, not an npm release or native
application release. The imported code is adapted from the source commit in
docs/extraction-manifest.json; SDK files and affected renderers were modified.
