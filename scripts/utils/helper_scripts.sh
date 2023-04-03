#!/usr/bin/env bash

# Functions
create_symlink() {
  src="$1"
  tgt="$2"

  if [ -e "$2" ]; then
    echo "'$2' already exists. Nothing to do."
  else
    echo "symlinking '$1'"
    ln -s "$src" "$tgt"
  fi
}
