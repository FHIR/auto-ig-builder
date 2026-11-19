#!/usr/bin/env bash
# Build the same IG commits with two ig-build images and compare the results:
# exit status, QA counts, and rendered HTML (ignoring per-run IDs and dates).
#
#   A=gcr.io/fhir-org-starter-project/ig-build:latest B=ig-build:candidate \
#     ./ab-test.sh [workdir] [org/repo ...]
#
# Needs Docker and ~8 GB RAM per concurrent build. The workdir keeps clones,
# publisher.jar and outputs, so reruns are quick.
set -uo pipefail
A=${A:-gcr.io/fhir-org-starter-project/ig-build:latest}
B=${B:?set B to the candidate image}
PUBLISHER=${PUBLISHER:-latest}
W=$(mkdir -p "${1:-./ab-work}" && cd "${1:-./ab-work}" && pwd); shift || true
IGS=${*:-"jmandel/ig-build-test HL7/smart-app-launch IHE/ITI.PDQm"}
cd "$W"

if [ ! -f publisher.jar ]; then
  base=https://github.com/HL7/fhir-ig-publisher/releases
  curl -fsSL -o publisher.jar "$([ "$PUBLISHER" = latest ] && echo "$base/latest/download" || echo "$base/download/$PUBLISHER")/publisher.jar"
fi
mkdir -p src runs/A runs/B
for ig in $IGS; do d=src/${ig//\//__}; [ -d "$d" ] || git clone -q --depth 1 "https://github.com/$ig" "$d"; done

run_one() {  # A|B org/repo
  local v=$1 ig=$2 n=${2//\//__} img; img=$([ "$1" = A ] && echo "$A" || echo "$B")
  local d=runs/$v/$n t0=$SECONDS
  rm -rf "$d"; mkdir -p "runs/$v"; cp -r "src/$n" "$d"; chmod -R a+rwX "$d"
  # Same steps as builder.py, as the image's own user with its own npm
  # settings: global sushi install, then the publisher.
  docker run --rm -v "$W/$d:/ig" -v "$W/publisher.jar:/publisher.jar:ro" -w /ig --entrypoint sh "$img" -c '
      npm -g install fsh-sushi >/tmp/npm.log 2>&1 || { cat /tmp/npm.log; exit 3; }
      java -Xmx8g -jar /publisher.jar -ig . -no-sushi-update -tx https://tx.fhir.org' \
    > "runs/$v/$n.log" 2>&1
  local rc=$?
  # hand the outputs back to the invoking user
  docker run --rm --user 0 -v "$W/$d:/ig" --entrypoint chown "$img" -R "$(id -u):$(id -g)" /ig
  echo "$v exit=$rc secs=$((SECONDS-t0)) $(grep -m1 -oE 'Errors: [0-9]+, Warnings: [0-9]+, Info: [0-9]+, Broken Links: [0-9]+' "runs/$v/$n.log")"
}

norm() {  # strip per-run UUIDs and timestamps
  sed -E 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/UUID/g
    s/(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} [0-9]+ [0-9:]+ [A-Z]{3,4} [0-9]{4}/DATE/g
    s/[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.]+([+-][0-9:]+|Z)?/DATE/g
    s/[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{2},? [0-9:]+ ?[AP]M/DATE/g
    s/(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]+ [A-Za-z]+,? [0-9]{4} [0-9:]+ ([+-][0-9]{4}|GMT)/DATE/g' "$1"
}

status=0
for ig in $IGS; do
  n=${ig//\//__}
  echo "== $ig"
  run_one A "$ig" > "runs/A.$n.txt" & run_one B "$ig" > "runs/B.$n.txt" & wait
  cat "runs/A.$n.txt" "runs/B.$n.txt"
  a=runs/A/$n/output b=runs/B/$n/output
  [ -d "$a" ] && [ -d "$b" ] || { echo "   missing output"; status=1; continue; }
  diff -q <(cut -d' ' -f4- "runs/A.$n.txt") <(cut -d' ' -f4- "runs/B.$n.txt") >/dev/null || { echo "   QA counts differ"; status=1; }
  total=0 bad=()
  while read -r f; do
    total=$((total+1))
    # qa-tx.html records the terminology server's HTTP response headers
    [ "$f" = ./qa-tx.html ] && continue
    [ -f "$b/$f" ] && cmp -s <(norm "$a/$f") <(norm "$b/$f") || bad+=("$f")
  done < <(cd "$a" && find . -name '*.html' | sort)
  echo "   html: ${#bad[@]} of $total pages differ"
  for f in "${bad[@]:0:5}"; do echo "     $f"; done
  [ ${#bad[@]} -eq 0 ] || status=1
done
exit $status
