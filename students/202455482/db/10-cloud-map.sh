# PostgreSQL 이미지(sclorg)가 서버를 기동할 때마다 실행하는 start 훅입니다.
# DB 사용자와 데이터베이스가 만들어진 뒤 실행되므로, 여기서 스키마·샘플·API View를 준비합니다.
# 테이블에 데이터가 이미 있으면 샘플을 다시 넣지 않습니다(PVC 데이터 유지).
psql -X -v ON_ERROR_STOP=1 \
  -d "$POSTGRESQL_DATABASE" \
  -v app_user="$POSTGRESQL_USER" \
  -f "${APP_DATA}/src/postgresql-start/init.sql"
