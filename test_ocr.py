import base64
import tempfile
import sys
from pathlib import Path
sys.path.append(r"d:\Projects\Mixed\Hakkutsu")

from backend.schemas import ImageOcrRequest
from backend.routers.processing import api_v1_image_ocr

req = ImageOcrRequest(
    image_data="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAZdEVYdFNvZnR3YXJlAHBhaW50Lm5ldCA0LjAuMTnU1rJ9AAAADUlEQVQYV2P4//8/AwAI/AL+X6XQbwAAAABJRU5ErkJggg==",
    language="jpn"
)

try:
    res = api_v1_image_ocr(req)
    print("SUCCESS", res)
except Exception as e:
    import traceback
    traceback.print_exc()
