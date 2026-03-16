# Clipboard Conversion Platforms

Shared conversion logic lives in [src/core/clipboardConversion.ts](../src/core/clipboardConversion.ts).

For external targets, bundle [platforms/shared/clipboard-converter-global.ts](shared/clipboard-converter-global.ts) into a standalone JavaScript file that exposes `globalThis.FreemanClipboardConverter`.

Platform responsibilities stay intentionally thin:

- Selection input
- Calling the shared converter
- Clipboard output

The sample Android, iOS, and browser-extension files in this folder assume that bundled artifact exists at platform-specific asset paths.
