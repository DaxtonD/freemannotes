-- Where the recognised text sits on each scanned page.
--
-- Find-in-document highlights a hit by asking pdf.js which text run it came from and turning
-- that back into a box. A scanned page has no text layer, so there is no run and no box: the
-- viewer finds the words (we OCR'd them) and then has nowhere to draw. PaddleOCR already
-- returns a polygon for every line it reads and we were throwing it away.
--
-- Stored as page fractions (0-1) rather than pixels so a highlight holds at any zoom and does
-- not depend on the resolution the page happened to be rendered at for recognition.
--
-- JSONB and nullable. Deliberately not part of any document list response - on a long scan this
-- is megabytes, and ocr_text already taught us what happens when a big column rides along in a
-- list that refreshes often. It is fetched on its own when the viewer opens.

ALTER TABLE "note_document_version"
ADD COLUMN "ocr_layout" JSONB;
