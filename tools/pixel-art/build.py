"""도트 그림을 다시 만들고 앱 에셋(6배 확대)으로 내보냅니다.
사용법: cd tools/pixel-art && python3 build.py   (Pillow 필요)
"""
import os
import subprocess
import sys
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
os.chdir(here)
subprocess.run([sys.executable, 'sprites.py'], check=True)
subprocess.run([sys.executable, 'office.py'], check=True)
out = os.path.join(here, '..', '..', 'assets', 'office')
os.makedirs(out, exist_ok=True)
for name in ['office_bg.png', 'office_fg.png', 'agents.png']:
    im = Image.open(name)
    im.resize((im.width * 6, im.height * 6), Image.NEAREST).save(os.path.join(out, name), optimize=True)
    os.remove(name)
if os.path.exists('agents_preview.png'):
    os.remove('agents_preview.png')
print('assets/office 갱신 완료')
