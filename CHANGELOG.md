# Changelog

## Unreleased

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
