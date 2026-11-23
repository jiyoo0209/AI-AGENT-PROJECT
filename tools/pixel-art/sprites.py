"""16x24 도트 캐릭터 스프라이트 시트 생성.
시트 한 줄 = 캐릭터 1명, 12프레임: [대기 0-2][아래 걷기 3-5][위 걷기 6-8][오른쪽 걷기 9-11]
"""
from PIL import Image

W, H = 16, 24


def hexc(h, a=255):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c[:3]) + (255,)


HEAD_DOWN = [
    "................",
    ".....OOOOOO.....",
    "....OHHhhHHO....",
    "...OHHhHHHHHO...",
    "..OHHHHHHHHHHO..",
    "..OHHHHHHHHHHO..",
    "..OHHSSHHSSHHO..",
    "..OHSSSSSSSSHO..",
    "..OsSESSSSESsO..",
    "..OsSESSSSESsO..",
    "..OSBSSSSSSBSO..",
    "...OSSSMMSSSO...",
    "....OOSSSSOO....",
]
BODY_DOWN = [
    "....OTTAATTO....",
    "...OTTTAATTTO...",
    "..OtOTTAATTOtO..",
    "..OtOTTTTTTOtO..",
    "..OSOttttttOSO..",
    "...OOttttttOO...",
]
HEAD_UP = [
    "................",
    ".....OOOOOO.....",
    "....OHHhhHHO....",
    "...OHHhHHHHHO...",
    "..OHHHHHHHHHHO..",
    "..OHHHHHHHHHHO..",
    "..OHHHHHHHHHHO..",
    "..OHHHHHHHHHHO..",
    "..OHHHHHHHHHHO..",
    "..OHHHhHHHHHHO..",
    "..OHHHHHHHHHHO..",
    "...OHHHHHHHHO...",
    "....OOSSSSOO....",
]
BODY_UP = [
    "....OTTTTTTO....",
    "...OTTTTTTTTO...",
    "..OtOTTTTTTOtO..",
    "..OtOTTTTTTOtO..",
    "..OSOttttttOSO..",
    "...OOttttttOO...",
]
HEAD_SIDE = [
    "................",
    ".....OOOOOO.....",
    "....OHHhhHHO....",
    "...OHHhHHHHHO...",
    "..OHHHHHHHHHHO..",
    "..OHHHHHHHHHHO..",
    "..OHHHHHHSSSHO..",
    "..OHHHHHSSSSSO..",
    "..OHHHHSSSSESO..",
    "..OHHHHSSSSESO..",
    "..OHHHsSSSSBSO..",
    "...OHHSSSSSSO...",
    "....OOSSSSOO....",
]
BODY_SIDE = [
    ".....OTTTTO.....",
    "....OTTTTTTO....",
    "....OTTTTTTO....",
    "....OTTSTTTO....",
    "....OttttttO....",
    "....OOttttOO....",
]
LEGS = {
    'stand': [
        "....OPPPPPPO....",
        "....OPPOOPPO....",
        "....OPpOOpPO....",
        "....OKKOOKKO....",
        ".....OO..OO.....",
    ],
    'left': [
        "....OPPPPPPO....",
        "....OPPOOPPO....",
        "....OPpOOKKO....",
        "....OKKO.OO.....",
        ".....OO.........",
    ],
    'right': [
        "....OPPPPPPO....",
        "....OPPOOPPO....",
        "....OKKOOpPO....",
        ".....OO.OKKO....",
        ".........OO.....",
    ],
    'side_stand': [
        ".....OPPPPO.....",
        ".....OPPPPO.....",
        ".....OPpPPO.....",
        ".....OKKKKKO....",
        "......OOOOO.....",
    ],
    'side_stride': [
        ".....OPPPPO.....",
        "....OPPOOPPO....",
        "...OPpO..OPPO...",
        "...OKKO..OKKKO..",
        "....OO....OOO...",
    ],
}


def grid(head, body, legs):
    g = [list(r) for r in head + body + LEGS[legs]]
    assert len(g) == H and all(len(r) == W for r in g), (len(g), [len(r) for r in g])
    return g


def setp(g, x, y, ch):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = ch


def long_hair(g, view):
    """어깨까지 오는 머리"""
    if view == 'side':
        for y in range(6, 15):
            setp(g, 3, y, 'H'); setp(g, 2, y, 'O' if y > 5 else g[y][2])
        for y in range(13, 16):
            setp(g, 4, y, 'H')
        setp(g, 3, 15, 'O'); setp(g, 4, 16, 'O')
        return
    for y in range(7, 15):
        for x in (2, 13):
            setp(g, x, y, 'H')
        setp(g, 1, y, 'O'); setp(g, 14, y, 'O')
    for x in (1, 2, 13, 14):
        setp(g, x, 15, 'O')
    if view == 'up':
        for y in range(12, 15):
            for x in range(3, 13):
                setp(g, x, y, 'H')


def ponytail(g, view):
    if view == 'down':
        for y in (3, 4, 5):
            setp(g, 14, y, 'H'); setp(g, 15, y, 'O')
        setp(g, 14, 2, 'O'); setp(g, 14, 6, 'O')
    elif view == 'up':
        setp(g, 7, 3, 'R'); setp(g, 8, 3, 'R')
        for y in (12, 13):
            setp(g, 6, y, 'O'); setp(g, 7, y, 'H'); setp(g, 8, y, 'H'); setp(g, 9, y, 'O')
        setp(g, 7, 14, 'O'); setp(g, 8, 14, 'O')
    else:
        for y in range(4, 10):
            setp(g, 1, y, 'H'); setp(g, 0, y, 'O')
        setp(g, 1, 10, 'O')


def glasses(g, view):
    if view == 'down':
        for x in (4, 5, 6, 9, 10, 11):
            setp(g, x, 7, 'G')
        for x in (4, 6, 9, 11):
            setp(g, x, 8, 'G'); setp(g, x, 9, 'G')
        setp(g, 7, 8, 'G'); setp(g, 8, 8, 'G')
    elif view == 'side':
        for x in (10, 11, 12):
            setp(g, x, 7, 'G')
        setp(g, 10, 8, 'G'); setp(g, 12, 8, 'G'); setp(g, 10, 9, 'G'); setp(g, 12, 9, 'G')


def headphones(g, view):
    band = [(3, 2), (4, 1), (5, 1), (6, 1), (7, 1), (8, 1), (9, 1), (10, 1), (11, 1), (12, 2)]
    if view in ('down', 'up'):
        for x, y in band:
            setp(g, x, y - 1 if y > 1 else 0, 'X')
        for y in (6, 7, 8):
            setp(g, 1, y, 'X'); setp(g, 14, y, 'X')
            setp(g, 2, y, 'X'); setp(g, 13, y, 'X')
    else:
        for x in range(4, 12):
            setp(g, x, 0, 'X')
        for y in (6, 7, 8):
            setp(g, 6, y, 'X'); setp(g, 7, y, 'X')


def beret(g, view):
    for x in range(5, 11):
        setp(g, x, 1, 'R')
    for x in range(4, 12):
        setp(g, x, 2, 'R')
    setp(g, 4, 1, 'O'); setp(g, 11, 1, 'O'); setp(g, 7, 0, 'O'); setp(g, 8, 0, 'O')


def hood(g, view):
    if view == 'down':
        for y in (13, 14):
            setp(g, 4, y, 'A'); setp(g, 11, y, 'A')
        setp(g, 6, 15, 'A'); setp(g, 9, 15, 'A')


CHARACTERS = [
    # id, hair, shirt, pants, accent, extras
    ('pm', '#2A2238', '#2B4C9B', '#2A2E45', '#D94A4A', ['tie']),
    ('planner', '#6B3E26', '#2E9ED6', '#3C4566', '#FFFFFF', ['long', 'glasses']),
    ('designer', '#C4512E', '#D9467F', '#3A3150', '#F7E3EC', ['beret']),
    ('publisher', '#1E1B29', '#E8742C', '#2F3B57', '#FFD0A8', ['headphones']),
    ('pl', '#5B3A29', '#7B55D6', '#33304A', '#E8E0FF', ['glasses']),
    ('developer', '#3B3330', '#2E9E57', '#2B3246', '#BFF0CF', ['messy']),
    ('tester', '#E0B04A', '#D8A31E', '#3E4A63', '#FFF3C4', ['ponytail']),
    ('ceo', '#2A2238', '#3A3F5C', '#2A2E45', '#D9A441', ['tie']),
]

SKIN = hexc('#F4CBA2')
OUT = hexc('#2B1E2F')


def palette(hair, shirt, pants, accent):
    hc = hexc(hair); sc = hexc(shirt); pc = hexc(pants)
    return {
        'O': OUT,
        'H': hc, 'h': shade(hc, 1.35),
        'S': SKIN, 's': shade(SKIN, 0.88),
        'E': hexc('#2B1E2F'), 'B': hexc('#F29A8E'), 'M': hexc('#C2655A'),
        'T': sc, 't': shade(sc, 0.78), 'A': hexc(accent),
        'P': pc, 'p': shade(pc, 0.8), 'K': hexc('#3A2A2A'),
        'G': hexc('#7D7A9C'), 'X': hexc('#55586E'), 'R': hexc('#8E2E3E'),
    }


def make_frame(view, legs, extras, variant=None):
    head = {'down': HEAD_DOWN, 'up': HEAD_UP, 'side': HEAD_SIDE}[view]
    body = {'down': BODY_DOWN, 'up': BODY_UP, 'side': BODY_SIDE}[view]
    g = grid(head, body, legs)
    if 'long' in extras:
        long_hair(g, view)
    if 'ponytail' in extras:
        ponytail(g, view)
    if 'messy' in extras and view != 'side':
        for x in (4, 7, 10):
            setp(g, x, 1, 'H'); setp(g, x, 0, 'O')
    if 'glasses' in extras:
        glasses(g, view)
    if 'headphones' in extras:
        headphones(g, view)
    if 'beret' in extras:
        beret(g, view)
    if 'hood' in extras:
        hood(g, view)
    if 'tie' not in extras and view == 'down':
        # 넥타이가 없으면 가운데 줄은 셔츠색, 깃만 남김
        for y in (14, 15):
            for x in (7, 8):
                if g[y][x] == 'A':
                    g[y][x] = 'T'
    if variant == 'type' and view == 'down':
        # 타자 치는 손: 손을 한 칸 위로
        setp(g, 3, 17, 't'); setp(g, 12, 17, 't'); setp(g, 3, 16, 'S'); setp(g, 12, 16, 'S')
    if variant == 'blink' and view == 'down':
        for x in range(3, 13):
            if g[8][x] == 'E':
                g[8][x] = 'S'
    return g


def frame_list(extras):
    return [
        make_frame('down', 'stand', extras),
        make_frame('down', 'stand', extras, 'type'),
        make_frame('down', 'stand', extras, 'blink'),
        make_frame('down', 'left', extras),
        make_frame('down', 'stand', extras),
        make_frame('down', 'right', extras),
        make_frame('up', 'left', extras),
        make_frame('up', 'stand', extras),
        make_frame('up', 'right', extras),
        make_frame('side', 'side_stride', extras),
        make_frame('side', 'side_stand', extras),
        make_frame('side', 'side_stride', extras),
        make_frame('down', 'stand', extras),
        make_frame('down', 'stand', extras),
        make_frame('down', 'stand', extras, 'blink'),
    ]


def build_sheet():
    sheet = Image.new('RGBA', (W * 15, H * len(CHARACTERS)), (0, 0, 0, 0))
    for row, (cid, hair, shirt, pants, accent, extras) in enumerate(CHARACTERS):
        pal = palette(hair, shirt, pants, accent)
        for i, g in enumerate(frame_list(extras)):
            for y in range(H):
                for x in range(W):
                    ch = g[y][x]
                    if ch != '.':
                        sheet.putpixel((i * W + x, row * H + y), pal[ch])
    return sheet


if __name__ == '__main__':
    s = build_sheet()
    s.save('agents.png')
    s.resize((s.width * 6, s.height * 6), Image.NEAREST).save('agents_preview.png')
    print(s.size)
