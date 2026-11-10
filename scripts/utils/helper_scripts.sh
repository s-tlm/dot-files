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

# Like create_symlink, but moves an existing real file or directory to
# "<target>.bak" first. Use for configs a tool creates on first run.
create_symlink_with_backup() {
  src="$1"
  tgt="$2"

  if [ -L "$tgt" ]; then
    echo "'$tgt' is already a symlink. Nothing to do."
    return
  fi

  if [ -e "$tgt" ]; then
    if [ -e "$tgt.bak" ]; then
      echo "'$tgt.bak' already exists. Skipping '$tgt'." >&2
      return 1
    fi
    echo "backing up '$tgt' to '$tgt.bak'"
    mv "$tgt" "$tgt.bak"
  fi

  mkdir -p "$(dirname "$tgt")"
  echo "symlinking '$src'"
  ln -s "$src" "$tgt"
}
