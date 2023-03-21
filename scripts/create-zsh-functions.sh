#!/usr/bin/env bash

# SHARED DIRS
REPO_DIR=$(git rev-parse --show-toplevel)
ZSH_TGT_FUNC_DIR="$HOME/.zsh_functions"
ZSH_SRC_FUNC_DIR="$REPO_DIR/zsh/functions"
HELPERS_DIR="$REPO_DIR/scripts/utils"

# Source helpers
source "$HELPERS_DIR/helper_scripts.sh"

printf "Configuring ZSH functions...\n"
create_dir_ifn_exists "$ZSH_TGT_FUNC_DIR"

# Create symlinks by looping through each function
for f in "${ZSH_SRC_FUNC_DIR}"/*; do
  create_symlink "$f" "$ZSH_TGT_FUNC_DIR"/.
done
