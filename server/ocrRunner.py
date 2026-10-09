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


def to_number_list(value) -> list[float]:
    """Flattens a polygon, a numpy array or any nesting of them into plain floats."""
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, bool):
        return []
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, (list, tuple)):
        out: list[float] = []
        for item in value:
            out.extend(to_number_list(item))
        return out
    return []


def bounding_box(points):
    """Any quadrilateral or [x1,y1,x2,y2] -> axis-aligned [x0, y0, x1, y1], or None."""
    nums = to_number_list(points)
    if len(nums) < 4:
        return None
    xs = nums[0::2]
    ys = nums[1::2]
    if not xs or not ys:
        return None
    return [min(xs), min(ys), max(xs), max(ys)]


def normalize_lines(value) -> list[dict]:
    """
    Recognised lines as {"text", "box"} in the image's own pixel space. The box is what lets a
    scanned page be highlighted like a digital one; without it the viewer can find a word and
    then has nowhere to draw. Shapes differ by PaddleOCR version, so this mirrors
    normalize_text's defensiveness: 3.x hands back a dict of parallel rec_texts/rec_polys
    lists, the older API a list of [polygon, (text, score)] pairs.
    """
    lines: list[dict] = []

    if value is None:
        return lines

    if isinstance(value, dict):
        texts = value.get("rec_texts")
        boxes = value.get("rec_boxes")
        if boxes is None:
            boxes = value.get("rec_polys")
        if boxes is None:
            boxes = value.get("dt_polys")
        if hasattr(boxes, "tolist"):
            boxes = boxes.tolist()
        if isinstance(texts, (list, tuple)):
            box_list = list(boxes) if isinstance(boxes, (list, tuple)) else []
            for index, text in enumerate(texts):
                if not isinstance(text, str):
                    continue
                stripped = text.strip()
                if not stripped:
                    continue
                box = bounding_box(box_list[index]) if index < len(box_list) else None
                lines.append({"text": stripped, "box": box})
            if lines:
                return lines
        for key in ("res", "result", "results", "data"):
            if key in value:
                lines.extend(normalize_lines(value.get(key)))
        return lines

    if isinstance(value, (list, tuple)):
        if len(value) >= 2 and isinstance(value[1], (list, tuple)) and len(value[1]) >= 1 and isinstance(value[1][0], str):
            stripped = value[1][0].strip()
            return [{"text": stripped, "box": bounding_box(value[0])}] if stripped else []
        for entry in value:
            lines.extend(normalize_lines(entry))
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


def ocr_one(ocr, image_path: str) -> tuple[str, list[dict]]:
    result = run_ocr(ocr, image_path)
    boxed = normalize_lines(result)
    if boxed:
        # One source of truth for the order the text is in, so the stored text and the stored
        # boxes can never disagree about which line is which.
        return "\n".join(line["text"] for line in boxed), boxed
    # No geometry available from this PaddleOCR build: still return the text, just unhighlightable.
    lines = normalize_text(result)
    return "\n".join(line for line in lines if line), []


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
            text, boxed = ocr_one(ocr, image_path)
            entry = {"index": index, "ok": True, "text": text, "lines": boxed}
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