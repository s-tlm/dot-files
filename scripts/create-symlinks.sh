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

# GHOSTTY
GHOSTTY_SRC_DIR="$REPO_DIR/ghostty"
GHOSTTY_TGT_DIR="$CONFIG_DIR/ghostty"

# PI
PI_SRC_DIR="$REPO_DIR/pi"
PI_TGT_DIR="$HOME/.pi/agent"

# AGENT SKILLS
SKILLS_SRC_DIR="$REPO_DIR/skills"
SKILLS_TGT_DIR="$HOME/.agents/skills"

# Helper scripts
source "$REPO_DIR/scripts/utils/helper_scripts.sh"

create_symlink "$ZSH_SRC_DIR/.zshrc" "$HOME/.zshrc"
create_symlink "$ZSH_SRC_DIR/.zshenv" "$HOME/.zshenv"
create_symlink "$NV_SRC_DIR" "$NV_TGT_DIR"
create_symlink "$SS_SRC_DIR" "$SS_TGT_TOML"
create_symlink "$GHOSTTY_SRC_DIR" "$GHOSTTY_TGT_DIR"

# Secrets, sessions, package caches, mcp.json and AGENTS.md stay in $PI_TGT_DIR on each machine.
# Copy AGENTS.md by hand: the dreams extension rejects a symlinked context file.
# mcp.json is local because it holds API keys.
for item in settings.json extensions agents skills; do
  create_symlink_with_backup "$PI_SRC_DIR/$item" "$PI_TGT_DIR/$item"
done

create_symlink_with_backup "$SKILLS_SRC_DIR" "$SKILLS_TGT_DIR"
