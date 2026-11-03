"""POST raw little-endian int16 16 kHz mono → {"vector": [...]}. Local CAM++ (same model as prod)."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import sherpa_onnx

ext = sherpa_onnx.SpeakerEmbeddingExtractor(
    sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(Path(__file__).parent / "data" / "campplus.onnx"), num_threads=4)
)


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        x = np.frombuffer(body, dtype="<i2").astype(np.float32) / 32768
        s = ext.create_stream()
        s.accept_waveform(16000, x)
        s.input_finished()
        v = np.asarray(ext.compute(s), dtype=np.float32)
        n = float(np.linalg.norm(v))
        out = json.dumps({"vector": (v / n if n else v).tolist()}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


ThreadingHTTPServer(("127.0.0.1", 18712), H).serve_forever()
