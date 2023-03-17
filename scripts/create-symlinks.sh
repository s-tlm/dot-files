#!/usr/bin/env bash

# TODO install missing pre-requisites
# TODO create symlink for custom nvchadrc

# SHARED DIRS
REPO_DIR=$(git rev-parse --show-toplevel)
CONFIG_DIR="$HOME/.config"

# ZSH
ZSH_SRC_DIR="$REPO_DIR/zsh"

ZSH_SRC_RC="$ZSH_SRC_DIR/.zshrc"
ZSH_TGT_RC="$HOME/.zshrc"

# NEOVIM
NV_SRC_DIR="$REPO_DIR/nvim/lua/custom"
NV_TGT_DIR="$CONFIG_DIR/nvim/lua/custom"

NV_SRC_RC="$NV_SRC_DIR/chadrc.lua"
NV_TGT_RC="$NV_TGT_DIR/chadrc.lua"
NV_SRC_INIT="$NV_SRC_DIR/init.lua"
NV_TGT_INIT="$NV_TGT_DIR/init.lua"
NV_SRC_PLUGIN_INIT="$NV_SRC_DIR/plugins/init.lua"
NV_TGT_PLUGIN_INIT="$NV_TGT_DIR/plugins/init.lua"
NV_SRC_MAPPINGS="$NV_SRC_DIR/mappings/init.lua"
NV_TGT_MAPPINGS="$NV_TGT_DIR/mappings/init.lua"

# STARSHIP
SS_SRC_DIR="$REPO_DIR/starship"

SS_SRC_TOML="$SS_SRC_DIR/starship.toml"
SS_TGT_TOML="$CONFIG_DIR/starship.toml"

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

check_dir_exists() {
  tgt_dir="$1"

  if [[ ! -d "$tgt_dir" ]]; then
    mkdir -p "$tgt_dir"
  fi
}

# Main
# TODO automate pre-requisite checks
echo ""
echo "Are the following installed?"
echo "----------------------------"
echo "SHELL - zsh"
echo "SHELL - oh-my-zsh"
echo "SHELL - starship"
echo "IDE   - neovim"
echo "IDE   - nvchad"
echo "----------------------------"
read -r -p "Continue with setup? [yn] " input
echo "----------------------------"

if [[ $input =~ ^[Yy]$ ]]; then

    printf "Configuring .zshrc symlink...\n"

    create_symlink "$ZSH_SRC_RC" "$ZSH_TGT_RC"

    printf "Configuring Neovim...\n"
    # Create neovim .config directory if not exists
    check_dir_exists "$NV_TGT_DIR/plugins"
    check_dir_exists "$NV_TGT_DIR/mappings"
    
    # Create symlinks
    create_symlink "$NV_SRC_RC" "$NV_TGT_RC"
    create_symlink "$NV_SRC_INIT" "$NV_TGT_INIT"
    create_symlink "$NV_SRC_PLUGIN_INIT" "$NV_TGT_PLUGIN_INIT"
    create_symlink "$NV_SRC_MAPPINGS" "$NV_TGT_MAPPINGS"
    
    printf "Configuring Starship...\n"

    create_symlink "$SS_SRC_TOML" "$SS_TGT_TOML"

fi

