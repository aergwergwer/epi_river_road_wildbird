// GIS 엑셀 입력 상태. 업로드·교체·삭제마다 작업 번호를 올려, 오래된 읽기 결과가 현재 상태를 덮어쓰지 못하게 한다.
//
// read(file): Promise<{points, skipped, sheet}>  — 파일을 읽어 지점 목록을 돌려준다.
// onInvalidate(): 입력이 바뀔 때마다 즉시 호출(이전 조회 결과·저장 버튼을 무효화).
// onChange({ message, tone, hasFile, reading, failed }): 안내 문구·버튼 상태를 갱신한다.
export function createGisInput({ read, onInvalidate, onChange }) {
  let job = 0, points = [], name = '', reading = false;
  const publish = (message, tone = 'info', extra = {}) => onChange({ message, tone, hasFile: points.length > 0 || !!name, reading, failed: false, ...extra });
  return {
    get points() { return points; },
    get name() { return name; },
    get reading() { return reading; },
    /** file이 null이면 삭제. 반환값: 이 작업이 최신으로 끝났으면 true. */
    async load(file) {
      const mine = ++job;
      points = [];
      name = '';
      reading = false;
      onInvalidate(); // 파일을 바꾸거나 지우는 순간 이전 조회 결과는 더 이상 유효하지 않다
      if (!file) { publish('엑셀을 올리지 않았습니다.'); return true; }
      reading = true;
      publish(`${file.name} 읽는 중… (끝나면 조회할 수 있습니다)`, 'info', { hasFile: true });
      try {
        const result = await read(file);
        if (mine !== job) return false; // 그 사이 삭제·교체됨: 오래된 결과는 버린다
        points = result.points;
        name = file.name;
        reading = false;
        publish(`${file.name}${result.sheet ? ` (시트 "${result.sheet}")` : ''} · 지점 ${points.length}개를 읽었습니다${result.skipped ? ` (좌표가 없거나 범위 밖인 ${result.skipped}행 제외)` : ''}. 조회하면 철새도래지 슬라이드에 올라갑니다.`);
        return true;
      } catch (error) {
        if (mine !== job) return false;
        reading = false;
        publish('엑셀을 읽지 못했습니다. ' + error.message, 'error', { hasFile: false, failed: true });
        return true;
      }
    },
  };
}
