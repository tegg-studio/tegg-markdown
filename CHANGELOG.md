# Changelog

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
