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

## Cloud Run 배포

이 앱은 `Google Cloud Run`에 바로 올릴 수 있습니다.

다만 현재는 파일 기반 저장 방식이라서, Cloud Run에서는 상태가 **임시 저장**됩니다.

- 앱이 재시작되거나 새 버전으로 다시 배포되면 상태가 초기화될 수 있습니다.
- 여러 인스턴스로 늘어나면 상태가 서로 어긋날 수 있습니다.

그래서 이 앱은 Cloud Run에 올릴 때 아래 전제로 쓰는 것이 좋습니다.

- 행사 당일용 임시 현황판으로 사용
- `max instances = 1`
- 행사 직전 배치 확인 후 배포
- 행사 중에는 재배포하지 않기

서버는 Cloud Run 환경에서 자동으로 `/tmp/oral-exam-board-data/state.json`에 상태를 저장합니다.

### 배포 순서

1. Google Cloud에서 프로젝트를 선택합니다.
2. Cloud Run API가 꺼져 있으면 켭니다.
3. Cloud Shell 또는 로컬 터미널에서 이 저장소 폴더로 이동합니다.
4. 아래 명령으로 배포합니다.

```bash
gcloud run deploy school-onsite-screening \
  --source . \
  --region asia-northeast3 \
  --allow-unauthenticated \
  --max-instances 1
```

배포가 끝나면 공개 URL이 발급되고, 그 주소로 아무 PC나 휴대폰에서 접속할 수 있습니다.

## Render 배포

Render로도 배포할 수 있게 [render.yaml](render.yaml)을 같이 넣어두었습니다.
