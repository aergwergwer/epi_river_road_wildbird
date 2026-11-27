#!/usr/bin/env python3
"""원본(타일 분할 전) 데이터를 전수 탐색해 기대값을 만든다. 타일 구현 검증용 fixture.

사용법: python3 tools/make_fixture.py --src data-src --out test/fixtures/expected.json
평면 근사가 아니라 원본과 같은 방위등거리 투영으로 계산한다.
"""
import argparse, glob, gzip, json, math, re

R = 6371008.8
RAD = math.pi / 180


def projector(lat0, lon0):
    phi0 = lat0 * RAD
    s0, c0 = math.sin(phi0), math.cos(phi0)

    def fwd(lon, lat):
        phi = lat * RAD
        d = (lon - lon0) * RAD
        e = math.cos(phi) * math.sin(d)
        n = c0 * math.sin(phi) - s0 * math.cos(phi) * math.cos(d)
        dot = s0 * math.sin(phi) + c0 * math.cos(phi) * math.cos(d)
        m = math.hypot(e, n)
        f = R * math.atan2(m, dot) / m if m else 0
        return e * f, n * f
    return fwd


def seg_dist(ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    l = dx * dx + dy * dy
    t = max(0, min(1, -(ax * dx + ay * dy) / l)) if l else 0
    return math.hypot(ax + t * dx, ay + t * dy)


def in_ring(ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > 0) != (yj > 0) and 0 < (xj - xi) * (0 - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def road_numbers(text):
    tokens = [t.strip() for t in str(text).split(',') if t.strip()]
    out = []
    for t in tokens:
        m = re.search(r'(\d+)\s*(호선|호)?$', t)
        if m and (m.group(2) or len(tokens) == 1):
            out.append(int(m.group(1)))
    return out


def load(path):
    with gzip.open(path, 'rt', encoding='utf-8') as h:
        return json.load(h)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', default='test/fixtures/expected.json')
    a = ap.parse_args()
    # 서울·부산·광주·강릉·제주·한강 하구·낙동강 하구·영산강·시화호·경계 근처 지점
    points = [(37.5665, 126.9780), (35.1796, 129.0756), (35.1595, 126.8526), (37.7519, 128.8761),
              (33.4996, 126.5312), (37.6720, 126.7040), (35.0970, 128.9600), (34.9400, 126.4500),
              (37.3000, 126.6200), (36.4800, 127.2500), (37.0000, 127.5000), (35.0300, 128.5000)]
    radius = 5000
    rivers, lakes = load(a.src + '/rivers.json.gz'), load(a.src + '/lakes.json.gz')
    roads = [f for p in sorted(glob.glob(a.src + '/roads-*.json.gz')) for f in load(p)['features']]
    out = []
    for lat, lon in points:
        fwd = projector(lat, lon)
        dlat = radius / 111320 * 1.02 + 1e-4
        dlon = dlat / max(0.2, math.cos(lat * RAD))

        def near(b):
            return not (b[2] < lon - dlon or b[0] > lon + dlon or b[3] < lat - dlat or b[1] > lat + dlat)
        waters = {}
        for kind, coll in (('river', rivers), ('lake', lakes)):
            for i, f in enumerate(coll['features']):
                if not near(f['bbox']):
                    continue
                g = f['geometry']
                polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
                best = math.inf
                inside = False
                for poly in polys:
                    proj = [[fwd(x, y) for x, y in ring] for ring in poly]
                    if in_ring(proj[0]) and not any(in_ring(r) for r in proj[1:]):
                        best, inside = 0.0, True
                        continue
                    if inside:
                        continue
                    for ring in proj:
                        for k in range(1, len(ring)):
                            best = min(best, seg_dist(*ring[k - 1], *ring[k]))
                if best > radius:
                    continue
                key = ('r:%d' % int(f['properties']['rivcd'])) if kind == 'river' else ('l:%d' % i)
                name = f['properties'].get('rivnm') or f['properties'].get('NAME')
                if key not in waters or best < waters[key][0]:
                    waters[key] = (best, name, inside)
        routes = {}
        for f in roads:
            if len(f['geometry']['coordinates']) < 2:
                continue  # 좌표가 비었거나 한 점뿐인 도형(원본에 3건)은 타일에서도 제외된다.
            xs = [c[0] for c in f['geometry']['coordinates']]
            ys = [c[1] for c in f['geometry']['coordinates']]
            if not near(f.get('bbox') or [min(xs), min(ys), max(xs), max(ys)]):
                continue
            kind = '국도' if f['properties']['RDDV'] == 'RDD002' else '지방도'
            pts = [fwd(x, y) for x, y in f['geometry']['coordinates']]
            d = min(seg_dist(*pts[k - 1], *pts[k]) for k in range(1, len(pts))) if len(pts) > 1 else math.inf
            if d > radius:
                continue
            for n in road_numbers(f['properties']['RDNU']):
                key = '%s:%d' % (kind, n)
                if key not in routes or d < routes[key]:
                    routes[key] = d
        out.append({'lat': lat, 'lon': lon, 'radius': radius,
                    'waters': sorted([[k, v[1], round(v[0], 3), v[2]] for k, v in waters.items()], key=lambda r: (r[2], r[0])),
                    'roads': sorted([[k, round(v, 3)] for k, v in routes.items()], key=lambda r: (r[1], r[0]))})
        print(lat, lon, len(waters), 'waters', len(routes), 'routes')
    with open(a.out, 'w', encoding='utf-8') as h:
        json.dump(out, h, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()
