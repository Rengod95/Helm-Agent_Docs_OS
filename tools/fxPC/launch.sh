#!/bin/bash
# usage: launch.sh <name> [appdir] — 묶은 앱을 임시 홈으로 띄운다(CDP 9388). pid는 $N/app.pid
N=/private/tmp/fxPC-$1
APP=${2:-$HOME/fresnel-tracks/fxPC/xeon/apps/desktop-shell/dist-app/Fresnel-darwin-arm64/Fresnel.app}
HOME=$N FRESNEL_HOME=$N/fresnel FRESNEL_DESKTOP_USER_DATA=$N/userdata SOPS_AGE_KEY_FILE= \
 nohup "$APP/Contents/MacOS/Fresnel" --remote-debugging-port=9388 > $N/app.log 2>&1 &
echo $! > $N/app.pid; echo pid $!
