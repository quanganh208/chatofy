"""Giữ sidecar TTS bận, đúng cảnh bản dịch câu trước đang được tổng hợp."""
import json, urllib.request

TEXT = "Tôi muốn đặt một phòng cho hai đêm, bắt đầu từ ngày mai buổi chiều."
while True:
    body = json.dumps({"text": TEXT, "language": "vi"}).encode()
    req = urllib.request.Request("http://localhost:8003/synthesize", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            r.read()
    except Exception:
        pass
