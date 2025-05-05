#!/usr/bin/env bash

# TODO install missing pre-requisites
# TODO automate pre-requisite checks

# SHARED DIRS
REPO_DIR=$(git rev-parse --show-toplevel)
CONFIG_DIR="$HOME/.config"

# ZSH
ZSH_SRC_DIR="$REPO_DIR/zsh"

# NVIM
NV_SRC_DIR="$REPO_DIR/nvim/s-tlm"
NV_TGT_DIR="$CONFIG_DIR/nvim"

# STARSHIP
SS_SRC_DIR="$REPO_DIR/starship/starship.toml"
SS_TGT_TOML="$CONFIG_DIR/starship.toml"

# Helper scripts
source "$REPO_DIR/scripts/utils/helper_scripts.sh"

# Main
echo ""
echo "Are the following installed?"
echo "----------------------------"
echo "SHELL - zsh"
echo "SHELL - oh-my-zsh"
echo "SHELL - starship"
echo "IDE   - neovim"
echo "----------------------------"
read -r -p "Continue with setup? [yn] " input
echo "----------------------------"

if [[ $input =~ ^[Yy]$ ]]; then

    create_symlink "$ZSH_SRC_DIR/.zshrc" "$HOME/.zshrc"
    create_symlink "$ZSH_SRC_DIR/.zshenv" "$HOME/.zshenv"
    create_symlink "$NV_SRC_DIR" "$NV_TGT_DIR"
    create_symlink "$SS_SRC_DIR" "$SS_TGT_TOML"

    echo ""
    echo "Done."

fi

