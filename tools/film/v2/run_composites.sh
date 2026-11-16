#!/usr/bin/env bash
# Film v2 composites (FILM-HERO-SPEC §1.3). Run from MEDIA/v2/a. Each command is also written to work/<dir>/cmd.txt
# together with the dir-prova command it was forked from (reproduced bit-exactly first, see repro/).
set -e
cd "$(dirname "$0")/.."
T=tools/screenrep_seq.py
run() { # dir, repro-cmd, cmd...
  local d=$1; shift; local rep=$1; shift
  mkdir -p work/$d
  { echo "# $d - dir-prova command reproduced bit-exactly (mean|d| 0, sm_corners identical) before any change:";
    echo "$rep"; echo "# v2 command:"; echo "python -I $*"; } > work/$d.cmd.tmp
  python -I "$@" > work/$d.log 2>&1
  mv work/$d.cmd.tmp work/$d/cmd.txt
  echo "done $d"
}
run s1h_bj_laptop "python -I tools/dp/screenrep_seq.py ../pexels/clips/6279145/6279145.mp4 repro/site_bj_d repro/s1g_bj_laptop --start 0.4 --n 75 --src-fps 30 --size 3840x2160 --site-gain 0.965   # site_bj_d = prep_site bj-d14-cta --from 0 --n 75 --chrome bjstudiodebelleza.ch" \
  $T ../pexels/clips/6279145/6279145.mp4 sites/bj_d_hold work/s1h_bj_laptop --start 0.4 --n 75 --src-fps 30 --size 3840x2160 --site-gain 0.965 &
run s3d_bj_prices "python -I tools/dp/screenrep_seq.py ../pexels/clips/6279154/6279154.mp4 repro/site_bj_prices/f0000.png repro/s3c_bj_prices --start 4.0 --n 75 --src-fps 30 --size 3840x2160 --notch --grow 3 --key-lo 50 --key-hi 160 --site-gain 0.965   # site_bj_prices = prep_site bj-ph-s1 --from 40 --n 1 --dpr 3 --pad-top-css 47" \
  $T ../pexels/clips/6279154/6279154.mp4 sites/bj_prices_2107/f0000.png work/s3d_bj_prices --start 4.0 --n 75 --src-fps 30 --size 3840x2160 --notch --grow 3 --key-lo 50 --key-hi 160 --site-gain 0.95 &
run s3e_zu_phone "python -I tools/dp/screenrep_seq.py ../pexels/clips/6279154/6279154.mp4 repro/site_zu_ph repro/s3_zu_phone --start 4.0 --n 75 --src-fps 30 --size 3840x2160 --notch --grow 3 --key-lo 50 --key-hi 160   # site_zu_ph = prep_site zu-ph-hold --from 75 --n 75 --dpr 3 --pad-top-css 47" \
  $T ../pexels/clips/6279154/6279154.mp4 sites/zu_ph_2107 work/s3e_zu_phone --start 4.0 --n 75 --src-fps 30 --size 3840x2160 --notch --grow 3 --key-lo 50 --key-hi 160 &
wait
run s6b_zk_pov "python -I tools/dp/screenrep_seq.py ../renderlab/assets/pexels/6279143_4k/6279143.mp4 repro/site_zk_d repro/s6_zk_pov --start 1.0 --n 72 --src-fps 30 --size 3840x2160 --site-gain 0.95   # site_zk_d = prep_site zk-d14-intro --from 3 --n 80 --chrome zurikey.ch" \
  $T ../renderlab/assets/pexels/6279143_4k/6279143.mp4 sites/zk_d_intro work/s6b_zk_pov --start 1.0 --n 72 --src-fps 30 --size 3840x2160 --site-map work/map_zk_d14_s6.json --site-gain 0.95 &
run m1b_bj_phone "python -I tools/dp/screenrep_seq.py ../pexels/clips/6279146/6279146.mp4 repro/site_bj_ph/f0000.png repro/m1_bj_phone --start 3.0 --n 75 --src-fps 30 --size 1080x1920 --notch --grow 4 --key-lo 50 --key-hi 160 --site-gain 0.965   # site_bj_ph = prep_site bj-ph-hold --from 0 --n 1 --dpr 3 --pad-top-css 47" \
  $T ../pexels/clips/6279146/6279146.mp4 sites/bj_ph_hold_2104/f0000.png work/m1b_bj_phone --start 3.0 --n 75 --src-fps 30 --size 1080x1920 --notch --grow 4 --key-lo 50 --key-hi 160 --site-gain 0.965 &
run m6b_zk_phone "python -I tools/dp/screenrep_seq.py ../pexels/clips/6279147/6279147.mp4 repro/site_zk_ph repro/m5_zk_phone --start 2.2 --n 75 --src-fps 30 --size 1080x1920 --notch --grow 4 --key-lo 50 --key-hi 160 --site-map work/map_zk_ph.json --site-gain 0.95   # site_zk_ph = prep_site zk-ph-s1 --from 0 --n 100 --dpr 3 --pad-top-css 47" \
  $T ../pexels/clips/6279147/6279147.mp4 sites/zk_ph_2111 work/m6b_zk_phone --start 2.2 --n 75 --src-fps 30 --size 1080x1920 --notch --grow 4 --key-lo 50 --key-hi 160 --site-map work/map_zk_ph.json --site-gain 0.94 --rigid --sat-key &
wait
