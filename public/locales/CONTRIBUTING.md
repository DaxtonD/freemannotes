# Locale Contribution Guide

FreemanNotes loads UI text from JSON files in this folder.

## Add a language

1. Copy `en.json` to `<code>.json` (example: `fr.json`).
2. Translate all values but keep key names unchanged.
3. Add the new code to `SUPPORTED_LOCALES` in `src/core/i18n.tsx`.
4. Keep punctuation and placeholders consistent with English source.

## Key format

- Keys are nested by feature (`prefs`, `editors`, `note`, etc.).
- Use short, stable keys because React components reference them directly.
- Missing keys automatically fall back to built-in English messages.

## Validation

- Run `npm run build` to verify the new locale file and key usage.
- Open Preferences → Appearance and switch language to test runtime loading.
