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
        {"use_angle_cls": True, "lang": "en", "show_log": show_log},
        {"use_angle_cls": True, "lang": "en"},
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
    if hasattr(ocr, "ocr"):
        return ocr.ocr(image_path, cls=True)
    if hasattr(ocr, "predict"):
        return ocr.predict(image_path)
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


def main() -> int:

    if len(sys.argv) >= 2 and sys.argv[1] == "--self-check":
        return self_check()

    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing-image-path"}))
        return 1

    image_path = sys.argv[1]

    try:
        ocr = create_ocr_instance()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"paddleocr-import-failed: {exc}"}))
        return 2

    try:
        result = run_ocr(ocr, image_path)
        lines = normalize_text(result)
        text = "\n".join(line for line in lines if line)
        print(json.dumps({"ok": True, "text": text}))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"paddleocr-run-failed: {exc}"}))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())