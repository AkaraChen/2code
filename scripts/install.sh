#!/bin/sh
# Copies this package into a Herdr app home (default ~/.config/herdr-app) and
# checks the mod. Copies, never symlinks: Herdr doesn't load SVGs or hot-reload
# through a symlinked mod folder.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}

mkdir -p "$home/layouts" "$home/themes" "$home/mods"
cp "$here/layouts/2code.json" "$here/layouts/2code.png" "$home/layouts/"
cp "$here/themes/2code-light.json" "$here/themes/2code-dark.json" "$home/themes/"
rm -rf "$home/mods/.2code.new"
cp -R "$here/mods/2code" "$home/mods/.2code.new"
rm -rf "$home/mods/2code"
mv "$home/mods/.2code.new" "$home/mods/2code"

herdr-app check "$home/mods/2code"
echo "Installed. Switch with: herdr-app do layout.switch --name 2code"
