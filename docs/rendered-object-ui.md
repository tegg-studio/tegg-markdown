# Rendered object UI contract (development candidate)

The shared editing UI keeps source authoritative. This is an unreleased checkout
contract; it does not describe the immutable npm preview.2 artifact.

- Images, formulas and diagrams have one top-right action group. Desktop hover and
  focus reveal the group; coarse pointers retain discoverable controls. Accessible
  labels remain on icon-only buttons. Copy/source commands live in the more menu.
- Editors with rendered previews use Source on the left and Preview on the right
  from a 600 CSS px content viewport. Below that they stack vertically. Maximum
  panel width is 840 px; host viewport bounds still apply. Link forms stay compact.
- Header/close and footer/cancel/apply remain visible; the middle region scrolls.
  X and Escape protect changed object drafts, except during IME composition.
  Cancel discards the draft; Apply writes through the existing source transaction
  and undo contract. Closing returns focus to the object or editor.
- Missing images use one neutral placeholder. A load failure alone does not prove
  deletion, missing permission or remote blocking. Resource policy remains Host-owned.
- Callouts retain semantic types and folding while using subtle fills and icons,
  without a heavy colored frame. Author content colors remain content semantics.
- Formula drafts use the trusted formula-rendering path so matrix positioning is
  preserved; generic Markdown sanitization is not weakened. Graphviz rendering
  starts after a Live Edit widget attaches to the DOM.

Regression entry points: `src/editingController.test.ts`,
`tests/browser/object-controls.spec.ts`, `tests/browser/engines.spec.ts` and
`tests/browser/reliable.spec.ts`. Layout coverage includes 1000/720/600/390 px,
preview updates, draft close/cancel/apply/undo, and initial Graphviz mounting.
Reported target browser results are not a full browser or assistive-technology
certification. Native hosts must separately verify their packaged runtime.
