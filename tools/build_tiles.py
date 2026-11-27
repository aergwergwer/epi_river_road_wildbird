#!/usr/bin/env python3
"""원본 하천·호수·도로 GeoJSON(.json.gz)을 격자 타일로 분할한다.

사용법:
    python3 tools/build_tiles.py --src <원본 .json.gz 폴더> --out assets/tiles

입력 파일(--src):
    rivers.json.gz, lakes.json.gz, roads-001.json.gz ... roads-008.json.gz

출력(--out):
    manifest.json                      비어 있지 않은 타일 목록과 격자 크기
    rivers/<ix>_<iy>.json.gz           하천 면 도형 (타일 경계에서 잘라냄)
    lakes/<ix>_<iy>.json.gz            호수·저수지 면 도형 (도형 전체를 겹치는 타일마다 복제)
    roads/<ix>_<iy>.json.gz            도로 중심선 (겹치는 타일마다 복제)

좌표 규칙:
    모든 좌표는 마이크로도(1e-6°) 정수다. 원본이 이미 소수점 6자리라 손실이 없다.
    링/선은 [x0, y0, dx1, dy1, dx2, dy2, ...] 형태의 평탄화된 차분 배열이다.
    타일 번호는 ix = floor(X / CELL), iy = floor(Y / CELL) 이다.

하천 타일은 타일 경계(+MARGIN)에서 잘라낸 도형이다. 잘린 면 때문에 생긴
인위적 변은 클라이언트가 "타일 창 경계 위의 변"으로 식별해 거리 계산에서 뺀다.
"""
import argparse
import glob
import gzip
import json
import math
import os
import re
import sys

CELL = {'rivers': 250_000, 'lakes': 250_000, 'roads': 100_000}
MARGIN = 2_000  # 하천 타일 창 여유 (0.002°, 약 200m). 이음매 방지용
ROAD_TYPES = {'RDD002': 2, 'RDD003': 3}  # 2=국도, 3=지방도. 다른 코드는 오류로 처리한다.


def to_int(point):
    return round(point[0] * 1e6), round(point[1] * 1e6)


def delta(points):
    flat = []
    px = py = 0
    for i, (x, y) in enumerate(points):
        if i == 0:
            flat += [x, y]
        else:
            flat += [x - px, y - py]
        px, py = x, y
    return flat


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def write_gz(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as raw:
        # mtime=0: 같은 입력이면 같은 바이트가 나오게 한다.
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, compresslevel=9, mtime=0) as gz:
            gz.write(text.encode('utf-8'))


def cell_of(x, y, cell):
    return math.floor(x / cell), math.floor(y / cell)


def cells_touched(rings, cell):
    """링의 꼭짓점과 긴 변이 지나는 타일 집합."""
    cells = set()
    for ring in rings:
        prev = None
        for x, y in ring:
            cells.add(cell_of(x, y, cell))
            if prev is not None:
                dx, dy = x - prev[0], y - prev[1]
                longest = max(abs(dx), abs(dy))
                if longest > cell // 2:
                    steps = longest // (cell // 4) + 1
                    for i in range(1, steps):
                        cells.add(cell_of(prev[0] + dx * i / steps, prev[1] + dy * i / steps, cell))
            prev = (x, y)
    return cells


def clip_ring(ring, xmin, ymin, xmax, ymax):
    """Sutherland–Hodgman 사각형 클리핑. 정수 좌표, 교차점의 경계 좌표는 정확히 경계값이다."""
    def clip(points, inside, intersect):
        out = []
        if not points:
            return out
        prev = points[-1]
        for cur in points:
            a, b = inside(prev), inside(cur)
            if b:
                if not a:
                    out.append(intersect(prev, cur))
                out.append(cur)
            elif a:
                out.append(intersect(prev, cur))
            prev = cur
        return out

    def at_x(bound):
        return lambda p, q: (bound, round(p[1] + (q[1] - p[1]) * (bound - p[0]) / (q[0] - p[0])))

    def at_y(bound):
        return lambda p, q: (round(p[0] + (q[0] - p[0]) * (bound - p[1]) / (q[1] - p[1])), bound)

    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else list(ring)
    pts = clip(pts, lambda p: p[0] >= xmin, at_x(xmin))
    pts = clip(pts, lambda p: p[0] <= xmax, at_x(xmax))
    pts = clip(pts, lambda p: p[1] >= ymin, at_y(ymin))
    pts = clip(pts, lambda p: p[1] <= ymax, at_y(ymax))
    # 연속 중복점 제거 후 닫기
    cleaned = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
    if len(cleaned) > 1 and cleaned[0] == cleaned[-1]:
        cleaned.pop()
    if len(cleaned) < 3:
        return None
    return cleaned + [cleaned[0]]


def polygons_of(geometry):
    if geometry['type'] == 'Polygon':
        return [geometry['coordinates']]
    if geometry['type'] == 'MultiPolygon':
        return geometry['coordinates']
    raise ValueError('면 도형이 아닙니다: ' + geometry['type'])


def ring_bbox(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return min(xs), min(ys), max(xs), max(ys)


def load(path):
    with gzip.open(path, 'rt', encoding='utf-8') as handle:
        return json.load(handle)


def build_rivers(src, out, tiles):
    data = load(os.path.join(src, 'rivers.json.gz'))
    cell = CELL['rivers']
    buckets = {}
    for feature in data['features']:
        props = feature['properties']
        grade = props['rivgrd2']
        if grade not in ('국가', '지방'):
            raise ValueError('알 수 없는 하천 등급: %r' % grade)
        polys = [[[to_int(p) for p in ring] for ring in poly] for poly in polygons_of(feature['geometry'])]
        candidates = cells_touched([ring for poly in polys for ring in poly], cell)
        # 여유 폭 안쪽에 걸친 이웃 타일도 후보에 넣는다.
        expanded = set(candidates)
        for ix, iy in candidates:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    expanded.add((ix + dx, iy + dy))
        for ix, iy in expanded:
            xmin, ymin = ix * cell - MARGIN, iy * cell - MARGIN
            xmax, ymax = (ix + 1) * cell + MARGIN, (iy + 1) * cell + MARGIN
            clipped_polys = []
            for poly in polys:
                outer = poly[0]
                bx0, by0, bx1, by1 = ring_bbox(outer)
                if bx1 < xmin or bx0 > xmax or by1 < ymin or by0 > ymax:
                    continue
                rings = []
                for ring in poly:
                    clipped = clip_ring(ring, xmin, ymin, xmax, ymax)
                    if clipped:
                        rings.append(delta(clipped))
                    elif ring is outer:
                        break  # 바깥 링이 창 밖이면 구멍도 창 밖이다.
                else:
                    if rings:
                        clipped_polys.append(rings)
            if clipped_polys:
                item = {'c': int(props['rivcd']), 'n': props['rivnm'], 'g': grade, 'p': clipped_polys}
                buckets.setdefault((ix, iy), []).append(dump(item))
    flush('rivers', out, buckets, tiles)


def build_lakes(src, out, tiles):
    data = load(os.path.join(src, 'lakes.json.gz'))
    cell = CELL['lakes']
    buckets = {}
    for index, feature in enumerate(data['features']):
        polys = [[[to_int(p) for p in ring] for ring in poly] for poly in polygons_of(feature['geometry'])]
        text = dump({'i': index, 'n': feature['properties']['NAME'], 'p': [[delta(r) for r in poly] for poly in polys]})
        for key in cells_touched([ring for poly in polys for ring in poly], cell):
            buckets.setdefault(key, []).append(text)
    flush('lakes', out, buckets, tiles)


def parse_road_numbers(text):
    """'제44호,제56호' -> [44, 56]. 끝이 잘린 토큰('제1')은 버린다."""
    tokens = [t.strip() for t in str(text).split(',') if t.strip()]
    numbers = []
    for token in tokens:
        match = re.search(r'(\d+)\s*(호선|호)?$', token)
        if match and (match.group(2) or len(tokens) == 1):
            numbers.append(int(match.group(1)))
    return numbers


def build_roads(src, out, tiles):
    cell = CELL['roads']
    buckets = {}
    count = dropped = 0
    for path in sorted(glob.glob(os.path.join(src, 'roads-*.json.gz'))):
        for feature in load(path)['features']:
            props = feature['properties']
            kind = ROAD_TYPES.get(props['RDDV'])
            if kind is None:
                raise ValueError('알 수 없는 도로 구분 코드: %r' % props['RDDV'])
            numbers = parse_road_numbers(props['RDNU'])
            if not numbers:
                dropped += 1
                continue
            geometry = feature['geometry']
            lines = [geometry['coordinates']] if geometry['type'] == 'LineString' else geometry['coordinates']
            for line in lines:
                points = [to_int(p) for p in line]
                if len(points) < 2:
                    continue
                text = dump([kind, numbers, delta(points)])
                xs = [p[0] for p in points]
                ys = [p[1] for p in points]
                x0, y0 = cell_of(min(xs), min(ys), cell)
                x1, y1 = cell_of(max(xs), max(ys), cell)
                for ix in range(x0, x1 + 1):
                    for iy in range(y0, y1 + 1):
                        buckets.setdefault((ix, iy), []).append(text)
                count += 1
        print('  도로', os.path.basename(path), '누적', count, file=sys.stderr)
    print('  번호를 해석하지 못해 제외한 도로 도형:', dropped, file=sys.stderr)
    flush('roads', out, buckets, tiles)


def flush(layer, out, buckets, tiles):
    names = []
    for (ix, iy), items in sorted(buckets.items()):
        name = '%d_%d' % (ix, iy)
        write_gz(os.path.join(out, layer, name + '.json.gz'), '[' + ','.join(items) + ']')
        names.append(name)
    tiles[layer] = names
    total = sum(os.path.getsize(os.path.join(out, layer, n + '.json.gz')) for n in names)
    print('%s: 타일 %d개, 합계 %.1f MB' % (layer, len(names), total / 1e6), file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--src', required=True)
    parser.add_argument('--out', default='assets/tiles')
    args = parser.parse_args()
    tiles = {}
    build_rivers(args.src, args.out, tiles)
    build_lakes(args.src, args.out, tiles)
    build_roads(args.src, args.out, tiles)
    manifest = {'version': 1, 'cell': CELL, 'margin': MARGIN, 'tiles': tiles}
    with open(os.path.join(args.out, 'manifest.json'), 'w', encoding='utf-8') as handle:
        handle.write(dump(manifest))


if __name__ == '__main__':
    main()
