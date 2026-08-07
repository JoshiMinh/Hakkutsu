import base64
from PIL import Image

base64_str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAZdEVYdFNvZnR3YXJlAHBhaW50Lm5ldCA0LjAuMTnU1rJ9AAAADUlEQVQYV2P4//8/AwAI/AL+X6XQbwAAAABJRU5ErkJggg=="
img_bytes = base64.b64decode(base64_str)

with open("test.png", "wb") as f:
    f.write(img_bytes)

try:
    with Image.open("test.png") as img:
        print("Success, format:", img.format, "size:", img.size)
except Exception as e:
    print("Error:", type(e), e)
