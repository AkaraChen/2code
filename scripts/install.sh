#!/bin/sh
# Copies this package into a Herdr app home (default ~/.config/herdr-app),
# merges its keys and checks the mod. Copies, never symlinks: Herdr doesn't
# load SVGs or hot-reload through a symlinked mod folder.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}

mkdir -p "$home/layouts" "$home/themes" "$home/mods"
cp "$here/layouts/2code.json" "$here/layouts/2code.png" "$home/layouts/"
cp "$here/themes/2code-light.json" "$here/themes/2code-dark.json" "$home/themes/"

# Keep the avatar cache across reinstalls.
cache=""
if [ -d "$home/mods/2code/.cache" ]; then
  cache=$(mktemp -d)
  cp -R "$home/mods/2code/.cache" "$cache/"
fi
rm -rf "$home/mods/.2code.new"
cp -R "$here/mods/2code" "$home/mods/.2code.new"
[ -n "$cache" ] && cp -R "$cache/.cache" "$home/mods/.2code.new/" && rm -rf "$cache"
rm -rf "$home/mods/2code"
mv "$home/mods/.2code.new" "$home/mods/2code"

# Adds the layout's keys (the "layout:2code" section of keys.json) to the
# person's keys.json. Keys they already bound stay theirs. Note: Herdr treats
# an edited keys.json as the person's and stops updating its defaults.
merge='
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
ours = json.load(open(src))
theirs = json.load(open(dst)) if os.path.exists(dst) else {}
added = 0
for section, keys in ours.items():
    have = theirs.setdefault(section, {})
    for key, action in keys.items():
        if key not in have:
            have[key] = action
            added += 1
if added:
    with open(dst + ".tmp", "w") as f:
        json.dump(theirs, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(dst + ".tmp", dst)
print("keys: %d added" % added)
'
if command -v python3 >/dev/null 2>&1; then
  python3 -c "$merge" "$here/keys.json" "$home/keys.json"
else
  echo "python3 not found: add the \"layout:2code\" section of $here/keys.json to $home/keys.json yourself."
fi

herdr-app check "$home/mods/2code"
echo "Installed. Switch with: herdr-app do layout.switch --name 2code"
