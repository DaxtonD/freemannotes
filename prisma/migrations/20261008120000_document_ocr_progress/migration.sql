-- Scanned PDFs finally get OCR'd.
--
-- Document text used to come only from the PDF's text layer, which a camera scan simply
-- doesn't have — so a scan extracted to "" and then got stamped COMPLETE, because nothing
-- had thrown. It looked processed and was invisible to search. The new queue in
-- server/documentOcrQueue.js renders the pages that have no text and runs PaddleOCR over
-- them, which takes real time on a long document, so the progress has to be somewhere the
-- other devices can see it.
--
-- ocr_pages_total counts only the pages that need recognising, not the whole document: a
-- mixed PDF keeps the text layer it already has. ocr_started_at is what separates "queued"
-- from "running" while the status is still PENDING, and it's the clock the client's
-- time-remaining estimate works from.

-- ocr_completed_at is the only thing separating "nothing has read this yet" from "it was read
-- and there was genuinely nothing on it" — both leave ocr_text empty. Without it the startup
-- sweep below would re-render and re-recognise every blank scan on every restart, forever.
ALTER TABLE "note_document_version"
ADD COLUMN "ocr_pages_total" INTEGER,
ADD COLUMN "ocr_pages_done" INTEGER,
ADD COLUMN "ocr_started_at" TIMESTAMP(3),
ADD COLUMN "ocr_completed_at" TIMESTAMP(3);

-- The queue looks for the next pending version after every document it finishes. Without
-- this that's a full scan of every version ever uploaded, every time.
CREATE INDEX "note_document_version_ocr_status_deleted_at_idx"
ON "note_document_version"("ocr_status", "deleted_at");
