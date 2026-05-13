# Custom Excalidraw Libraries

Drop custom `.excalidrawlib` files into this folder and Freeman Notes will expose them through `/api/excalidraw-libraries` without a server restart.

## How it works

- The server scans `third-party/excalidraw-libraries/` every time the drawing library endpoints are requested.
- Any file ending in `.excalidrawlib` is treated as a custom Excalidraw library.
- The drawing editor auto-loads everything returned by `/api/excalidraw-libraries`, so bundled libraries and custom dropped-in libraries are merged into the user's Excalidraw library automatically.
- Because Excalidraw library state is persisted locally in the browser, newly dropped libraries appear the next time a drawing is opened and survive app restarts.

## Required file format

Use Excalidraw library files, not raw images.

- Required type: `.excalidrawlib`
- Expected content: Excalidraw library JSON
- No fixed image size is required: library items are normally vector Excalidraw elements, so there is no required pixel dimension.

If you create shapes from images, package them into a valid `.excalidrawlib` first. Freeman Notes does not convert loose `.png`, `.jpg`, `.webp`, or `.svg` files in this folder into library items automatically.

## Naming

- `my-project-icons.excalidrawlib` becomes a custom library with the id `custom-my-project-icons`
- If no sidecar metadata file is present, the visible name is derived from the filename

## Optional metadata sidecar

You can add a JSON file with the same basename to control the displayed metadata.

Example files:

- `my-project-icons.excalidrawlib`
- `my-project-icons.json`

Example metadata:

```json
{
  "name": "My Project Icons",
  "author": "Acme Design Team",
  "description": "Reusable project-specific shapes for the ACME rollout."
}
```

## Operator workflow

1. Build the custom shapes in Excalidraw.
2. Export them as an Excalidraw library file.
3. Copy the `.excalidrawlib` file into this folder.
4. Optionally add a same-name `.json` metadata file.
5. Open a drawing in Freeman Notes. The library is picked up automatically.

## Notes

- The production server does not need to restart just because a new file is dropped here.
- If a browser already has the drawing editor open, close and reopen that drawing to trigger the library refresh path.
- Users can still manage or reset libraries from Excalidraw's native library UI.