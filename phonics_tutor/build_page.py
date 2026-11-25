"""Bundle static/ into one self-contained page (dist/pip-phonics.html) for publishing."""
import re
from pathlib import Path

root = Path(__file__).parent
static = root / "static"
html = (static / "index.html").read_text()
head = html.split("<head>", 1)[1].split("</head>", 1)[0]
body = html.split("<body>", 1)[1].split("</body>", 1)[0]

title = re.search(r"<title>.*?</title>", head).group(0)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts[^>]+>', head).group(0)
css = (static / "styles.css").read_text()

def inline(m):
    js = (static / m.group(1)).read_text()
    assert "</script" not in js
    return f"<script>\n{js}\n</script>"

body = re.sub(r'<script src="([^"]+)"></script>', inline, body)
out = f"{title}\n{fonts}\n<style>\n{css}\n</style>\n{body}"
(root / "dist").mkdir(exist_ok=True)
(root / "dist" / "pip-phonics.html").write_text(out)
print("wrote", root / "dist" / "pip-phonics.html", len(out), "bytes")
