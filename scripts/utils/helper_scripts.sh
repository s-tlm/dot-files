#!/usr/bin/env bash

# Functions
create_symlink() {
  src="$1"
  tgt="$2"

  if test -f "$tgt";
  then
    echo -e "Existing file at $tgt found. Skipped.\n"
  else
    echo -e "Creating symlink from $src to $tgt.\n"
    ln -s "$src" "$tgt"
    echo -e "Done.\n"
  fi
}

create_dir_ifn_exists() {
  tgt_dir="$1"

  if [[ ! -d "$tgt_dir" ]]; then
    mkdir -p "$tgt_dir"
  fi
}

