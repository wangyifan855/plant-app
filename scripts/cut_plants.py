# 把 14 张作物插画的白底抠成透明，统一高度后输出到 frontend/assets/plants/
# 用法：python scripts/cut_plants.py
from PIL import Image, ImageFilter
import numpy as np
from collections import deque
import os

SRC_DIR = os.path.expandvars(r'C:\Users\Administrator\.workbuddy\clipboard-images')
OUT = 'frontend/assets/plants'
PREVIEW_DIR = 'docs/preview'

# 剪贴板文件名尾号 -> crops.js 里的英文名（也就是输出的文件名）
JOBS = [
    ('584Z-cc07a76a', 'tomato'),
    ('586Z-08a97b92', 'potato'),
    ('588Z-2c9bb042', 'grape'),
    ('590Z-a00e9949', 'corn'),
    ('591Z-cd4329b7', 'strawberry'),
    ('593Z-f8239ff8', 'blueberry'),
    ('594Z-b1f07261', 'cherry'),
    ('595Z-c905ab7c', 'apple'),
    ('596Z-13b39ad5', 'peach'),
    ('598Z-1ec4664b', 'orange'),
    ('599Z-61798ee7', 'pepper'),
    ('599Z-c762e6d7', 'raspberry'),
    ('600Z-3c666d68', 'soybean'),
    ('601Z-5ce16779', 'squash'),
]

# 阈值放得比较保守：这些插画里有浅灰的葡萄支架、浅色的土堆，
# 阈值太松会把支架当成背景一起吃掉。
TOL = 34          # 与纯白的最大差距，超过就认为不是背景
SAT = 20          # 允许的色彩偏移（灰底/白底才合格）
RIM_MIN = 232     # 补刀阈值：贴着透明区的浅白（232 以上）才算残留白边
TARGET_H = 240    # 统一高度（显示最大 120px，240 够 2 倍屏）
MAX_W = 285


def cut_background(path):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    a = np.asarray(im).astype(np.int16)

    # 背景 = 从四角出发、接近纯白且色彩中性的连通区域
    near_white = (a.min(axis=2) >= 255 - TOL) & (a.max(axis=2) - a.min(axis=2) <= SAT)
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
    # 羽化 + 内缩，去掉描边外侧的残留白边
    am = Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(1.0))
    alpha = np.asarray(am).astype(np.uint8)
    alpha = np.where(alpha < 120, 0, alpha)

    # 补刀：树冠/土堆边缘的白底常被枝叶挡成一个个小岛，flood fill 到不了，
    # 这里从透明区往里反复「啃」，只吃贴着透明的浅白（RIM_MIN 以上），
    # 葡萄的灰色支架（亮度 ~190）不会被误伤。
    whiteish = (a.min(axis=2) >= RIM_MIN) & (a.max(axis=2) - a.min(axis=2) <= 22)
    for _ in range(160):
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

    return Image.fromarray(np.dstack([np.asarray(im), alpha]), 'RGBA')


def drop_white_islands(im, min_area=170):
    """删掉被枝叶整圈围住的白色小岛。
    flood fill 只能从边界漫进去，叶子缝里那些白底岛它够不着；
    这里按连通域算面积，大块的才删 —— 果实上的白色高光点很小，会留着，不然果子会失去光泽。"""
    arr = np.array(im)
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3]
    h, w = alpha.shape
    white = (
        (rgb.min(axis=2) >= 245)
        & (rgb.max(axis=2) - rgb.min(axis=2) <= 12)
        & (alpha > 0)
    )
    visited = np.zeros((h, w), bool)
    removed = 0
    for y0 in range(h):
        for x0 in range(w):
            if not white[y0, x0] or visited[y0, x0]:
                continue
            stack = [(x0, y0)]
            visited[y0, x0] = True
            cells = []
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if 0 <= nx < w and 0 <= ny < h and white[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((nx, ny))
            if len(cells) >= min_area:
                for cx, cy in cells:
                    alpha[cy, cx] = 0
                removed += 1
    arr[:, :, 3] = alpha
    return Image.fromarray(arr, 'RGBA'), removed


def normalize(im):
    bbox = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        im = im.crop(bbox)
    scale = min(TARGET_H / im.height, MAX_W / im.width)
    size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    return im.resize(size, Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
made = []
for suffix, name in JOBS:
    matches = [f for f in os.listdir(SRC_DIR) if suffix in f]
    if not matches:
        print('missing', suffix)
        continue
    src = os.path.join(SRC_DIR, matches[0])
    cut = cut_background(src)
    cut, islands = drop_white_islands(cut)
    out = normalize(cut)
    dst = os.path.join(OUT, f'{name}.png')
    out.save(dst, optimize=True)
    made.append((name, out))
    print(f'{name:12s} {out.size[0]}x{out.size[1]}  {os.path.getsize(dst)//1024}KB  清掉白岛 {islands}')

# 预览：贴在草绿底上排成两行，检查白边 / 缺角
os.makedirs(PREVIEW_DIR, exist_ok=True)
CELL_W, CELL_H = 240, 360
cols = 7
rows = (len(made) + cols - 1) // cols
prev = Image.new('RGB', (CELL_W * cols, CELL_H * rows), (198, 227, 150))
for i, (name, im) in enumerate(made):
    x = (i % cols) * CELL_W
    y = (i // cols) * CELL_H
    # 缩到格子内再贴，否则窄图和宽图会互相盖住，看不出边缘问题
    fit = im.copy()
    fit.thumbnail((CELL_W - 24, CELL_H - 30), Image.LANCZOS)
    prev.paste(fit, (x + (CELL_W - fit.width) // 2, y + CELL_H - fit.height - 12), fit)
prev.save(os.path.join(PREVIEW_DIR, 'plants_cut_preview.png'))
print('preview ok ->', os.path.join(PREVIEW_DIR, 'plants_cut_preview.png'))
