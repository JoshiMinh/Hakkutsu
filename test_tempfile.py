import tempfile
from pathlib import Path
from PIL import Image

with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
    f.write(b'hello')
    temp_path = Path(f.name)
    print("Trying to open with PIL while open...")
    try:
        with open(temp_path, "rb") as test_f:
            print("Successfully opened")
    except Exception as e:
        print("ERROR:", e)
