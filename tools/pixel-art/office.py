"""나만의사무실 맵 (195x234 원본 픽셀, 화면에서는 2배).
bg.png = 바닥·벽·가구(캐릭터 뒤), fg.png = 책상 앞면(앉은 캐릭터를 가림).
"""
from PIL import Image, ImageDraw

MW, MH = 195, 234
OUT = (43, 30, 47, 255)


def c(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


bg = Image.new('RGBA', (MW, MH), c('#2B1E2F'))
fg = Image.new('RGBA', (MW, MH), (0, 0, 0, 0))
B = ImageDraw.Draw(bg)
F = ImageDraw.Draw(fg)


def R(d, x, y, w, h, col):
    if w > 0 and h > 0:
        d.rectangle([x, y, x + w - 1, y + h - 1], fill=col)


def box(d, x, y, w, h, fill, outline=OUT):
    R(d, x, y, w, h, outline)
    R(d, x + 1, y + 1, w - 2, h - 2, fill)


def P(d, x, y, col):
    d.point((x, y), fill=col)


def shadow(d, x, y, w, h=2):
    R(d, x, y, w, h, (20, 12, 24, 70))


# ---------- 바닥 ----------
def wood(x0, y0, w, h, base, light, dark):
    for y in range(y0, y0 + h):
        row = (y - y0) // 5
        for x in range(x0, x0 + w):
            col = base
            if (y - y0) % 5 == 4:
                col = dark
            else:
                off = (row * 13) % 24
                if (x - x0 + off) % 24 == 0:
                    col = dark
                elif (x * 7 + y * 3 + row * 5) % 29 == 0:
                    col = light
            P(B, x, y, col)


def carpet(x0, y0, w, h, base, alt, border):
    R(B, x0, y0, w, h, base)
    for y in range(y0 + 3, y0 + h - 3, 6):
        for x in range(x0 + 3, x0 + w - 3, 6):
            P(B, x, y, alt); P(B, x + 1, y, alt); P(B, x, y + 1, alt)
            P(B, x + 3, y + 3, alt)
    R(B, x0 + 1, y0 + 1, w - 2, 1, border); R(B, x0 + 1, y0 + h - 2, w - 2, 1, border)
    R(B, x0 + 1, y0 + 1, 1, h - 2, border); R(B, x0 + w - 2, y0 + 1, 1, h - 2, border)


def tiles(x0, y0, w, h, a, b, grout):
    for y in range(y0, y0 + h):
        for x in range(x0, x0 + w):
            tx, ty = (x - x0) // 8, (y - y0) // 8
            col = a if (tx + ty) % 2 == 0 else b
            if (x - x0) % 8 == 7 or (y - y0) % 8 == 7:
                col = grout
            P(B, x, y, col)


CAP = c('#4A3B52')
CAP_HI = c('#5E4D68')
PAPER = c('#EADFC4')
PAPER_LINE = c('#DCCDAA')
BASE = c('#8A6544')


def wall_face(x, y, w, h, paper=PAPER, line=PAPER_LINE):
    R(B, x, y, w, h, paper)
    for xx in range(x, x + w):
        if xx % 6 == 0:
            R(B, xx, y, 1, h - 2, line)
    R(B, x, y + h - 2, w, 2, BASE)
    R(B, x, y + h - 2, w, 1, c('#A57C55'))


def wall_cap(x, y, w, h):
    R(B, x, y, w, h, CAP)
    R(B, x, y, w, 1, CAP_HI)


def window(x, y, w=16, h=7):
    box(B, x, y, w, h, c('#7A5233'))
    R(B, x + 1, y + 1, w - 2, h - 2, c('#9FD7F2'))
    R(B, x + 1, y + 1, w - 2, 2, c('#C6ECFB'))
    R(B, x + w // 2, y + 1, 1, h - 2, c('#7A5233'))
    P(B, x + 3, y + 2, c('#FFFFFF')); P(B, x + 4, y + 2, c('#FFFFFF'))


# 방 바닥
wood(0, 13, 63, 63, c('#C8955E'), c('#D8A971'), c('#A97842'))          # 기획실
carpet(66, 13, 63, 63, c('#8E3B46'), c('#A44A55'), c('#D9A441'))       # 대표실
wood(132, 13, 63, 63, c('#D9B07C'), c('#E6C291'), c('#BC9160'))        # 디자인실
wood(0, 86, 195, 70, c('#C8955E'), c('#D8A971'), c('#A97842'))         # 홀
carpet(100, 92, 52, 34, c('#4F6D96'), c('#5E7EA8'), c('#C9D6E8'))      # PM 러그
tiles(0, 166, 63, 68, c('#7E8DA6'), c('#74839C'), c('#65738A'))        # 개발실
tiles(66, 166, 63, 68, c('#EFE2C6'), c('#E3D2B0'), c('#D4C29E'))       # 휴게실
tiles(132, 166, 63, 68, c('#B6C4D2'), c('#A9B8C6'), c('#98A7B6'))      # 테스트룸

# 바깥 윗벽
wall_cap(0, 0, 195, 3)
wall_face(0, 3, 195, 10)
for wx in (6, 30, 88, 106, 140, 170):
    window(wx, 4)

# 세로 칸막이
for x0 in (63, 129):
    wall_cap(x0, 3, 3, 73)
    wall_cap(x0, 159, 3, 75)

# 가로 벽 1 (방 ↔ 홀) — 문: 기획 44-60, 대표 89-105, 디자인 150-166
DOORS1 = [(44, 16), (89, 17), (136, 16)]
DOORS2 = [(44, 16), (72, 50), (150, 16)]


def h_wall(y_cap, doors):
    x = 0
    spans = []
    for dx, dw in doors:
        spans.append((x, dx - x)); x = dx + dw
    spans.append((x, MW - x))
    for sx, sw in spans:
        wall_cap(sx, y_cap, sw, 3)
        wall_face(sx, y_cap + 3, sw, 7)
    for dx, dw in doors:
        R(B, dx, y_cap, dw, 10, c('#B9884F'))
        R(B, dx, y_cap + 9, dw, 1, c('#8A6544'))


h_wall(76, DOORS1)
h_wall(156, DOORS2)

# ---------- 가구 ----------
DESK = c('#B07443'); DESK_HI = c('#C98A55'); DESK_SIDE = c('#8B5A33'); DESK_DK = c('#6B4428')


def desk(x, y, w, h=8, front=6):
    """책상: 상판은 fg(앉은 사람의 몸을 가림), 앞면도 fg"""
    shadow(B, x + 1, y + h + front, w, 2)
    R(F, x, y, w, h, OUT)
    R(F, x + 1, y + 1, w - 2, h - 2, DESK)
    R(F, x + 1, y + 1, w - 2, 1, DESK_HI)
    R(F, x, y + h, w, front, OUT)
    R(F, x + 1, y + h, w - 2, front - 1, DESK_SIDE)
    R(F, x + 1, y + h, w - 2, 1, DESK_DK)
    for xx in range(x + 4, x + w - 3, 9):
        R(F, xx, y + h + 2, 3, 1, DESK_DK)


def monitor(d, x, y, on=True, glow='#7FE3C4'):
    box(d, x, y, 12, 9, c('#2D2A3A'))
    R(d, x + 1, y + 1, 10, 6, c(glow) if on else c('#3A4458'))
    if on:
        R(d, x + 2, y + 2, 5, 1, c('#FFFFFF', 200)); R(d, x + 2, y + 4, 7, 1, c('#FFFFFF', 120))
    R(d, x + 5, y + 9, 2, 2, c('#2D2A3A')); R(d, x + 3, y + 11, 6, 1, c('#2D2A3A'))


def papers(d, x, y):
    box(d, x, y, 7, 5, c('#FFF8E8'))
    R(d, x + 2, y + 2, 3, 1, c('#9A96B0'))


def mug(d, x, y, col='#F07A63'):
    box(d, x, y, 4, 4, c(col)); P(d, x + 4, y + 1, OUT); P(d, x + 4, y + 2, OUT)


def plant(x, y, big=False):
    shadow(B, x, y + 11, 8)
    leaves = [c('#2F6E3B'), c('#3F8F4F'), c('#5BB062')]
    R(B, x + 1, y + 7, 6, 5, OUT); R(B, x + 2, y + 7, 4, 4, c('#B5603C')); R(B, x + 2, y + 7, 4, 1, c('#D27A52'))
    pts = [(3, 0), (2, 1), (4, 1), (1, 2), (3, 2), (5, 2), (0, 3), (2, 3), (4, 3), (6, 3), (1, 4), (3, 4), (5, 4), (2, 5), (4, 5), (3, 6)]
    if big:
        pts += [(7, 2), (-1, 2), (6, 5), (0, 5)]
    for i, (px, py) in enumerate(pts):
        P(B, x + 1 + px, y + py, leaves[(i * 7) % 3])
    P(B, x + 4, y, c('#7CC97F'))


def bookshelf(x, y, w=20, h=22):
    shadow(B, x, y + h, w)
    box(B, x, y, w, h, c('#6B4430'))
    cols = ['#F07A63', '#6CB6F0', '#F5C04A', '#5FD3A6', '#B79CE8', '#E8E0D0', '#D9467F']
    for sy in range(y + 2, y + h - 3, 7):
        R(B, x + 1, sy + 5, w - 2, 1, c('#4A2E20'))
        xx = x + 2; i = sy
        while xx < x + w - 3:
            bw = 2 + (i % 2)
            bh = 4 + (i % 2)
            R(B, xx, sy + 5 - bh, bw, bh, c(cols[i % len(cols)]))
            xx += bw + (1 if i % 3 == 0 else 0); i += 3


def chair_back(x, y, col='#3A3F5C'):
    box(B, x, y, 12, 8, c(col)); R(B, x + 2, y + 2, 8, 1, c('#5A6082'))


# 기획실: 책장, 책상(좌), 화이트 메모판, 화분
bookshelf(42, 5, 19, 22)
R(B, 4, 6, 16, 8, OUT); R(B, 5, 7, 14, 6, c('#F4EFE6'))
for i, col in enumerate(['#F5C04A', '#6CB6F0', '#F07A63']):
    R(B, 6 + i * 4, 8, 3, 3, c(col))
desk(4, 44, 36)
monitor(F, 27, 36, True, '#8FD0FF')
papers(F, 6, 46)
plant(4, 60)

# 대표실: 큰 책상, 의자, 트로피장, 화분, 명패
box(B, 89, 12, 16, 20, c('#7A2F3B'))
R(B, 91, 14, 12, 14, c('#943A48'))
R(B, 91, 14, 12, 1, c('#D9A441')); R(B, 96, 17, 2, 2, c('#D9A441'))
box(B, 86, 22, 4, 9, c('#5A2A33')); box(B, 104, 22, 4, 9, c('#5A2A33'))
desk(80, 30, 36, 9, 7)
R(F, 92, 32, 12, 3, c('#D9A441')); R(F, 93, 33, 10, 1, c('#8E5E1A'))
papers(F, 82, 32)
mug(F, 108, 32, '#FFF4DC')
box(B, 69, 5, 14, 20, c('#6B4430'))
for i, col in enumerate(['#D9A441', '#C0C6D6', '#D9A441']):
    R(B, 72 + (i % 2) * 5, 8 + i * 6, 3, 4, c(col))
plant(119, 30, True)
plant(68, 62)
R(B, 91, 77, 15, 0, OUT)

# 디자인실: 이젤, 책상(우), 물감, 화분
R(B, 178, 26, 1, 16, c('#6B4430')); R(B, 189, 26, 1, 16, c('#6B4430')); R(B, 184, 30, 1, 12, c('#6B4430'))
box(B, 175, 12, 18, 17, c('#FFF8E8'))
R(B, 177, 14, 6, 6, c('#F07A63')); R(B, 182, 17, 8, 6, c('#6CB6F0')); R(B, 178, 22, 5, 4, c('#F5C04A')); R(B, 185, 24, 5, 3, c('#5FD3A6'))
desk(156, 44, 36)
monitor(F, 178, 36, True, '#F7A8C8')
for i, col in enumerate(['#F07A63', '#F5C04A', '#6CB6F0', '#5FD3A6']):
    R(F, 158 + i * 3, 47, 2, 2, c(col))
plant(184, 60)

# 홀: 퍼블리셔 책상(좌), PM 책상(가운데), PL 책상(우), 캐비닛, 정수기, 화분
desk(2, 112, 38)
monitor(F, 27, 104, True, '#FFC48A')
desk(106, 112, 28)
papers(F, 108, 114)
papers(F, 125, 115)
desk(156, 112, 38)
monitor(F, 179, 104, True, '#C7B5FF')
box(B, 64, 88, 8, 14, c('#D8E4EE')); R(B, 65, 89, 6, 5, c('#8FD0FF')); R(B, 66, 96, 4, 4, c('#9AA6B8'))
shadow(B, 64, 102, 8)
plant(4, 138, True)
plant(184, 138)

# 개발실: 서버랙, 책상(듀얼 모니터)
box(B, 3, 160, 13, 34, c('#2D2A3A'))
for i in range(5):
    R(B, 5, 164 + i * 6, 9, 4, c('#3A4458'))
    P(B, 12, 165 + i * 6, c('#5FD3A6') if i % 2 == 0 else c('#F5C04A'))
shadow(B, 3, 194, 13)
desk(18, 200, 38)
monitor(F, 40, 192, True, '#7FE3C4')
mug(F, 20, 202, '#5FD3A6')

# 휴게실: 커피머신 카운터, 자판기, 소파, 테이블
box(B, 68, 162, 30, 10, c('#8B5A33')); R(B, 69, 163, 28, 2, c('#B07443'))
box(B, 71, 154, 9, 10, c('#2D2A3A')); R(B, 73, 156, 5, 3, c('#F07A63')); P(B, 75, 160, c('#5FD3A6'))
mug(B, 84, 159, '#FFF4DC'); mug(B, 90, 159, '#F5C04A')
box(B, 110, 156, 16, 26, c('#C94B5A')); R(B, 112, 159, 12, 14, c('#9FD7F2'))
for i in range(3):
    for j in range(2):
        R(B, 113 + j * 6, 160 + i * 4, 4, 3, c(['#F5C04A', '#5FD3A6', '#F07A63'][(i + j) % 3]))
R(B, 112, 176, 12, 3, OUT)
shadow(B, 110, 182, 16)
shadow(B, 78, 226, 34)
box(B, 78, 212, 34, 14, c('#5B8F7B')); R(B, 79, 213, 32, 4, c('#6FA98F')); R(B, 78, 210, 4, 16, OUT); R(B, 108, 210, 4, 16, OUT)
R(B, 79, 211, 2, 14, c('#4E7D6B')); R(B, 109, 211, 2, 14, c('#4E7D6B'))
box(B, 86, 196, 18, 9, c('#B07443')); R(B, 87, 197, 16, 1, c('#C98A55'))
mug(B, 90, 198, '#FFF4DC')
plant(70, 214)

# 테스트룸: 폰 진열대, 책상
box(B, 176, 160, 16, 26, c('#6B4430'))
for i in range(3):
    R(B, 177, 166 + i * 7, 14, 1, c('#4A2E20'))
    for j in range(3):
        box(B, 178 + j * 4, 161 + i * 7, 3, 5, c('#2D2A3A'))
        P(B, 179 + j * 4, 162 + i * 7, c('#8FD0FF'))
shadow(B, 176, 186, 16)
desk(136, 200, 34)
monitor(F, 157, 192, False)
box(F, 138, 202, 5, 7, c('#2D2A3A')); R(F, 139, 203, 3, 4, c('#3A4458'))
plant(136, 214)

# 대표실 문패
box(B, 85, 77, 25, 0, OUT)

bg.save('office_bg.png')
fg.save('office_fg.png')
print('ok')
