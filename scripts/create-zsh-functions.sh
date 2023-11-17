#!/usr/bin/env bash

# SHARED DIRS
REPO_DIR=$(git rev-parse --show-toplevel)
HELPERS_DIR="$REPO_DIR/scripts/utils"
ZSH_TGT_FUNC_DIR="$HOME/.zsh_functions"
ZSH_SRC_FUNC_DIR="$REPO_DIR/zsh/functions"

# Source helpers
source "$HELPERS_DIR/helper_scripts.sh"

printf "Configuring ZSH functions...\n"
create_symlink "${ZSH_SRC_FUNC_DIR}" "${ZSH_TGT_FUNC_DIR}"
