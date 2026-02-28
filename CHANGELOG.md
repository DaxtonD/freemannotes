# Changelog

All notable changes to this project are documented in this file.

## 1.0.1 - 2026-02-27

### Added
- Detailed inline maintenance comments across core app, grid, card, editor, and CRDT files.
- Explicit in-code guidance for where to adjust card width and responsive mobile/desktop behavior.
- Startup reflow-animation suppression comments and drag overlay sizing documentation.

### Changed
- Note grid responsive behavior refined for stability:
  - Desktop card width remains fixed while column count responds to available space.
  - Mobile portrait enforces 2 columns.
  - Mobile card width is computed from stable device short-side values and reused in portrait and landscape.
- Drag overlay width behavior stabilized on mobile to avoid ghost width jumps.
- Initial refresh behavior no longer animates cards back into place during hydration.

### Fixed
- Same-column drag swap visual artifacts from conflicting transform ownership.
- Resize and orientation edge cases causing inconsistent card widths on mobile.
- Mobile landscape scroll jitter that caused subtle card-width changes.
