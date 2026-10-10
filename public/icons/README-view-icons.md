# Replaceable view-mode icons

`view-card.svg` and `view-detailed.svg` are the icons for the Card and Detailed List buttons in
the view picker. They exist as files rather than Font Awesome icons because the free set has
nothing that fits: a masonry grid, and a heavier version of `bars`.

**To change one, overwrite the file.** No code change — `src/App.tsx` points at these paths and
`.app-view-mode-mask-icon` in `src/styles/layout.css` does the drawing.

## What the file has to be

They are painted as a **CSS mask over `currentColor`**, not placed as images. That is what lets
them turn accent-coloured on hover and while selected, the same as the Font Awesome icons beside
them, from one file with no light/dark pair.

It also means:

- **Colour in the file is discarded.** Only the alpha channel is used — solid where you want ink,
  transparent where you don't. A black icon and a pink one render identically.
- **Strokes need to be real shapes.** `stroke` is fine, but anything relying on `fill="none"` plus
  a stroke colour still works; what will *not* work is expecting two different colours in one
  icon. There is only ink and not-ink.
- **Give it a square `viewBox`.** It is drawn into an 18×18 box with `mask-size: contain`, so a
  non-square icon will letterbox rather than crop.
- **Don't rely on CSS inside the SVG.** Masks do not run scripts, and external stylesheets will
  not load. Inline presentation attributes only.

A 24×24 `viewBox` with ~2 units of padding matches the existing two and will sit at the same
visual weight as the Font Awesome icons next to them.

## Adding another one

Put the file here, then add `maskSrc: '/icons/your-file.svg'` to that entry in `viewModeOptions`
(`src/App.tsx`). Keep the `icon:` field too — it is required, and it is what renders for entries
that have no `maskSrc`.

**A wrong path fails silently, as a blank space.** A CSS mask has no error event, so nothing can
fall back to the Font Awesome icon the way a broken `<img>` would. If a button goes empty after
you swap a file, check the filename before anything else.
