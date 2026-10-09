import json
import os
import sys


def normalize_text(value) -> list[str]:
    lines: list[str] = []

    if value is None:
        return lines

    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []

    if isinstance(value, dict):
        for key in ("rec_texts", "texts", "text", "transcription", "label", "value"):
            if key in value:
                lines.extend(normalize_text(value.get(key)))
        for key in ("res", "result", "results", "data"):
            if key in value:
                lines.extend(normalize_text(value.get(key)))
        return lines

    if isinstance(value, (list, tuple)):
        if len(value) >= 2 and isinstance(value[1], (list, tuple)) and len(value[1]) >= 1 and isinstance(value[1][0], str):
            text = value[1][0].strip()
            return [text] if text else []
        for entry in value:
            lines.extend(normalize_text(entry))
        return lines

    return lines


def create_ocr_instance():
    from paddleocr import PaddleOCR  # type: ignore

    show_log = str(os.getenv("OCR_LOG_OUTPUT", "")).strip() == "1"

    attempts = [
        {
            "lang": "en",
            "show_log": show_log,
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        },
        {
            "lang": "en",
            "use_doc_orientation_classify": False,
            "use_doc_unwarping": False,
            "use_textline_orientation": False,
        },
        {"lang": "en", "show_log": show_log},
        {"lang": "en"},
    ]
    last_error: Exception | None = None
    for kwargs in attempts:
        try:
            return PaddleOCR(**kwargs)
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"paddleocr-constructor-failed: {last_error}")


def run_ocr(ocr, image_path: str):
    if hasattr(ocr, "predict"):
        return ocr.predict(image_path)
    if hasattr(ocr, "ocr"):
        return ocr.ocr(image_path)
    raise RuntimeError("paddleocr-api-unsupported")


def self_check() -> int:
    try:
        import paddle  # type: ignore
        from paddleocr import PaddleOCR  # type: ignore
        instance = create_ocr_instance()

        print(
            json.dumps(
                {
                    "ok": True,
                    "paddle": getattr(paddle, "__version__", "unknown"),
                    "paddleocr": getattr(sys.modules.get("paddleocr"), "__version__", "unknown"),
                    "class": getattr(PaddleOCR, "__name__", "PaddleOCR"),
                    "runner": instance.__class__.__name__,
                }
            )
        )
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"ocr-self-check-failed: {exc}"}))
        return 4


def ocr_one(ocr, image_path: str) -> str:
    result = run_ocr(ocr, image_path)
    lines = normalize_text(result)
    return "\n".join(line for line in lines if line)


def emit(payload) -> None:
    # One JSON object per line, flushed as it happens. Node reads these back as they arrive to
    # move a scanned document's page counter along (server/documentOcrQueue.js). The LAST line
    # is always the summary, which is the only line the single-image caller looks at.
    print(json.dumps(payload), flush=True)


def main() -> int:

    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        return self_check()

    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing-image-path"}))
        return 1

    # Every argument is an image to read. Handing over several at once is how a scanned PDF gets
    # done: building a PaddleOCR instance loads a few hundred MB of model and takes seconds, and
    # paying that per page would cost far more than the actual recognising.
    image_paths = sys.argv[1:]

    try:
        ocr = create_ocr_instance()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"paddleocr-import-failed: {exc}"}))
        return 2

    results = []
    for index, image_path in enumerate(image_paths):
        try:
            entry = {"index": index, "ok": True, "text": ocr_one(ocr, image_path)}
        except Exception as exc:
            # One unreadable page shouldn't throw away the pages that did come out; the caller
            # decides what a partly-failed batch is worth.
            entry = {"index": index, "ok": False, "error": f"paddleocr-run-failed: {exc}"}
        results.append(entry)
        emit({"type": "page", **entry})

    # Every page failing is a failed batch. One bad page among good ones isn't.
    if not any(entry["ok"] for entry in results):
        first_error = next((entry.get("error") for entry in results if not entry["ok"]), None)
        emit({"ok": False, "error": first_error or "paddleocr-run-failed", "results": results})
        return 3
    # `text` is what keeps the single-image path working unchanged: it's just the first result.
    emit({"ok": True, "text": results[0].get("text", "") if results else "", "results": results})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())