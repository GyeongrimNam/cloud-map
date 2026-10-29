#!/bin/sh
# 원본 파일(db/, data/, web/)로 k8s/의 ConfigMap YAML을 다시 만듭니다.
# 원본을 수정한 뒤에만 실행합니다. 배포·채점에는 필요 없습니다.
#   사용법: sh tools/build-configmaps.sh   (학번 폴더에서 실행)
set -eu
cd "$(dirname "$0")/.."

configmap() {
  name=$1; out=$2; shift 2
  oc create configmap "$name" "$@" --dry-run=client -o yaml \
    | oc label --local -f - app.kubernetes.io/part-of=cloud-map -o yaml \
    | sed '/creationTimestamp: null/d' > "k8s/$out"
  echo "k8s/$out"
}

# DB 초기화 스크립트
configmap cloud-map-db-init db-init-configmap.yaml \
  --from-file=10-cloud-map.sh=db/10-cloud-map.sh \
  --from-file=init.sql=db/init.sql

# 샘플 데이터: 구성 / 점검 원문(영문) / 점검 번역(한국어)을 각각 별도 ConfigMap으로 만듭니다.
# oc apply가 저장하는 last-applied 주석은 ConfigMap 하나당 256KiB까지라서 하나로 합칠 수 없습니다.
configmap cloud-map-sample-architecture sample-architecture-configmap.yaml \
  --from-file=architecture-sample.json=data/architecture-sample.json
configmap cloud-map-sample-findings-en sample-findings-en-configmap.yaml \
  --from-file=prowler-sample.json=data/prowler-sample.json
configmap cloud-map-sample-findings-ko sample-findings-ko-configmap.yaml \
  --from-file=translations.json=data/translations.json

# 웹 화면 파일
configmap cloud-map-web web-configmap.yaml \
  --from-file=index.html=web/index.html \
  --from-file=style.css=web/style.css \
  --from-file=app.js=web/app.js

# 구성도 아이콘(SVG)
icons=""
for f in web/icons/*.svg; do
  icons="$icons --from-file=icon-$(basename "$f")=$f"
done
# shellcheck disable=SC2086
configmap cloud-map-web-icons web-icons-configmap.yaml $icons

configmap cloud-map-web-nginx web-nginx-configmap.yaml \
  --from-file=api.conf=web/nginx-api.conf
