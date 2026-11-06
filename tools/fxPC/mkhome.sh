#!/bin/bash
# usage: mkhome.sh <name> -> /private/tmp/fxPC-<name> (모델 설정·키만 scB-home에서 복사, 홈은 700)
set -e; umask 077; N=/private/tmp/fxPC-$1; rm -rf "$N"; mkdir -p "$N/fresnel/config" "$N/userdata"
cp -R /private/tmp/scB-home/fresnel/config/. "$N/fresnel/config/"; cp /private/tmp/scB-home/age.key "$N/age.key"
sed -i '' "s#/private/tmp/scB-home/age.key#$N/age.key#" "$N/fresnel/config/settings.json"
# 대화 이력 없이 작업 폴더만 쓰려고 빈 데이터 대신: 데이터 복사 뒤 모든 대화의 작업 폴더를 새 임시 폴더로 바꾼다(네이티브 폴더 창은 자동화하지 않는다)
if [ "$2" = withdata ]; then
  mkdir -p "$N/proj"; cp -R /private/tmp/scB-home/fresnel/data "$N/fresnel/data"
  sqlite3 "$N/fresnel/data/fresnel.db" "update p_threads set workspace='$N/proj' where workspace is not null; delete from sys_leases;"
fi
chmod -R go-rwx "$N"; echo "$N"
