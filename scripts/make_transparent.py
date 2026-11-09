# 把新 IP 形象的白色圆底抠成透明，裁到内容边距后统一输出 512x512
# 用法：python scripts/make_transparent.py
from PIL import Image, ImageFilter
import numpy as np
from collections import deque
import os

SRC = 'prototype/mascot/redesign/v2_hat'
OLD = 'prototype/mascot/redesign'
OUT = 'frontend/assets'

# 目标文件名 -> 源图（六张戴帽形象）
JOBS = [
    ('mascot_identify.png', os.path.join(SRC, 'Cute_chibi_baby_crocodile_masc_2026-11-08T14-25-33.png')),  # 举番茄
    ('mascot_graft.png',    os.path.join(SRC, 'Cute_chibi_baby_crocodile_masc_2026-11-08T14-26-22.png')),  # 挖土
    ('mascot_community.png', os.path.join(SRC, 'Cute_chibi_baby_crocodile_masc_2026-11-08T14-26-37.png')),  # 抱黄瓜+向日葵
    ('mascot_track.png',    os.path.join(SRC, 'Cute_chibi_baby_crocodile_masc_2026-11-08T14-26-59.png')),  # 浇水
    ('mascot_carrot.png',   os.path.join(SRC, 'Cute_chibi_baby_crocodile_masc_2026-11-08T14-26-01.png')),  # 胡萝卜（备用）
    ('mascot_cucumber.png', os.path.join(OLD, 'Cute_chibi_baby_crocodile_masc_2026-11-08T14-21-22.png')),  # 抱大黄瓜（备用）
]

TOL = 90  # 背景判定容差（灰底 #F7F7F7 与白圆 #FFFFFF 差很小，一起吃掉）
RIM_MIN = 168  # 白圆自带柔和灰边，亮度低到这个程度也要能啃掉（低于它的浅色字符不会被误吃）


def cut_background(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    a = np.asarray(im).astype(np.int16)

    # 背景 = 从四角出发、「接近白/浅灰」且连通的区域
    near_white = (a.min(axis=2) >= 255 - TOL) & (a.max(axis=2) - a.min(axis=2) <= 24)
    seen = np.zeros((h, w), dtype=bool)
    dq = deque()
    for sx, sy in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        if near_white[sy, sx] and not seen[sy, sx]:
            seen[sy, sx] = True
            dq.append((sx, sy))
    while dq:
        x, y = dq.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not seen[ny, nx] and near_white[ny, nx]:
                seen[ny, nx] = True
                dq.append((nx, ny))

    alpha = np.where(seen, 0, 255).astype(np.uint8)
    # 边缘羽化：让描边外不要留硬白边
    am = Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(1.2))
    alpha = np.asarray(am).astype(np.uint8)
    # 内缩一点，抹掉残留的浅色描边外围像素
    alpha = np.where(alpha < 110, 0, alpha)

    # 补刀：有些残留的白/浅灰圈会被水花、叶子挡住而没被 flood fill 连通，
    # 这里从透明区域往内反复「啃」，凡是接近白且贴着透明的像素都收掉。
    whiteish = (a.min(axis=2) >= RIM_MIN) & (a.max(axis=2) - a.min(axis=2) <= 22)
    for _ in range(90):
        trans = alpha == 0
        grow = np.zeros_like(trans)
        grow[1:, :] |= trans[:-1, :]
        grow[:-1, :] |= trans[1:, :]
        grow[:, 1:] |= trans[:, :-1]
        grow[:, :-1] |= trans[:, 1:]
        eat = grow & whiteish & (~trans)
        if not eat.any():
            break
        alpha[eat] = 0

    out = np.dstack([np.asarray(im), alpha])
    return Image.fromarray(out, 'RGBA')


def fit_square(im, size=512, margin_ratio=0.06):
    bbox = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    inner = int(size * (1 - margin_ratio * 2))
    im.thumbnail((inner, inner), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(im, ((size - im.width) // 2, (size - im.height) // 2))
    return canvas


for name, src in JOBS:
    if not os.path.exists(src):
        print('missing', src)
        continue
    cut = cut_background(src)
    out = fit_square(cut)
    dst = os.path.join(OUT, name)
    out.save(dst, optimize=True)
    print('saved', dst, os.path.getsize(dst) // 1024, 'KB')

# 预览：贴在浅绿底上，确认没白边
prev = Image.new('RGB', (512 * 3, 512 * 2), (238, 247, 228))
for i, name in enumerate(["mascot_identify.png", "mascot_graft.png", "mascot_community.png", "mascot_track.png", "mascot_carrot.png", "mascot_cucumber.png"]):
    p = os.path.join(OUT, name)
    if os.path.exists(p):
        prev.paste(Image.open(p).convert('RGBA'), ((i % 3) * 512, (i // 3) * 512), Image.open(p).convert('RGBA'))
PREVIEW_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs', 'preview')
os.makedirs(PREVIEW_DIR, exist_ok=True)
prev.save(os.path.join(PREVIEW_DIR, 'preview_mascot_transparent.png'))
print('preview ok')
