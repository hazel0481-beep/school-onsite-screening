# 학생 구강검진 현황판

하루 동안 여러 담임이 동시에 접속해서 학급별 구강검진 상태를 표시하는 웹앱입니다.

## 로컬 실행

```bash
/Users/hazel/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

실행 후 접속 주소:

- 이 컴퓨터에서: `http://localhost:3100`
- 같은 와이파이에서: `http://이-맥의-IP주소:3100`

## 사용 순서

1. `학급 설정` 버튼을 눌러 학교 이름, 제목, 학급 배치를 수정합니다.
2. 각 층에 학급을 추가하거나 삭제한 뒤 `배치 저장`을 누릅니다.
3. 담임은 자기 학급 창을 눌러 `검진 전 -> 검진 중 -> 완료` 순서로 상태를 바꿉니다.

## 데이터 저장 방식

- 기본 상태 파일: [data/state.json](data/state.json)
- 서버는 시작할 때 상태 파일을 읽고, 변경될 때마다 같은 파일에 즉시 저장합니다.
- `DATA_DIR` 환경변수가 있으면 그 폴더의 `state.json`을 사용합니다.

## Render 배포

이 앱은 상태를 파일에 저장하므로, 배포할 때도 **지속 디스크가 있는 단일 서버**로 올리는 것이 안전합니다.

이 저장소에는 Render용 설정 파일 [render.yaml](render.yaml)이 포함되어 있습니다.

배포 흐름:

1. 이 프로젝트를 GitHub 저장소로 올립니다.
2. Render에서 `Blueprint` 또는 `New Web Service`로 저장소를 연결합니다.
3. `render.yaml`을 그대로 사용해 배포합니다.
4. 첫 배포 시 현재 [data/state.json](data/state.json)의 학교명/배치가 시드 데이터로 복사됩니다.
5. 이후에는 Render 디스크의 `/var/data/state.json`에만 상태가 저장됩니다.

운영 메모:

- 인스턴스는 1대로 유지하는 것이 좋습니다.
- 파일 기반 저장이라 여러 인스턴스로 늘리면 상태가 어긋날 수 있습니다.
- 행사 전날 배치 설정을 끝낸 뒤 한 번 배포하고, 행사 당일에는 배포를 다시 하지 않는 편이 안전합니다.
