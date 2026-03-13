import json
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "missing-image-path"}))
        return 1

    image_path = sys.argv[1]

    try:
        from paddleocr import PaddleOCR  # type: ignore
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"paddleocr-import-failed: {exc}"}))
        return 2

    try:
        ocr = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
        result = ocr.ocr(image_path, cls=True)
        lines = []
        for page in result or []:
            for row in page or []:
                if not row or len(row) < 2:
                    continue
                text_tuple = row[1]
                if not text_tuple or not text_tuple[0]:
                    continue
                lines.append(str(text_tuple[0]).strip())
        text = "\n".join(line for line in lines if line)
        print(json.dumps({"ok": True, "text": text}))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"paddleocr-run-failed: {exc}"}))
        return 3


if __name__ == "__main__":
    raise SystemExit(main())