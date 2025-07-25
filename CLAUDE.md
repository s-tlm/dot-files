# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Repository Overview

This is a personal dotfiles repository containing configuration files for:

- **Neovim**: Comprehensive IDE setup with LSP, plugins, and custom keybindings
- **Zsh**: Shell configuration with custom functions and themes
- **Starship**: Cross-shell prompt configuration
- **Ghostty**: Terminal emulator configuration
- **Git**: Version control settings

## Setup Commands

### Prerequisites

The configuration files in this repository are for the following tools.

- zsh + oh-my-zsh
- starship
- neovim
- A Nerd Font
- bat
- eza
- catppuccin-zsh

### Initial Setup

There are two helper scripts to symlink the configuration files within this repo
to the `$HOME` directory. Symlinking allows us to modify the configuration files
within this repository and have them also reflect in the `$HOME` directory.

```bash
# Create symlinks for all configurations
./scripts/create-symlinks.sh

# Set up Zsh functions
./scripts/create-zsh-functions.sh
```

## Architecture

### Directory Structure

- `nvim/s-tlm/`: Complete Neovim configuration
  - `lua/config/`: Core configuration modules
  - `lua/plugins/`: Plugin specifications and configurations
- `zsh/`: Shell configuration and custom functions
- `scripts/`: Setup and utility scripts
- `starship/`: Prompt configuration
- `ghostty/`: Terminal emulator settings

### Neovim Configuration Architecture

The Neovim setup uses a modular Lua-based configuration:

1. **Plugin Management**: Uses lazy.nvim for plugin management with auto-updating
2. **LSP Setup**: Configured language servers for multiple languages:
   - Python (basedpyright), Lua (lua_ls), Bash (bashls)
   - Docker, JSON, YAML, SQL, Terraform, HTML/CSS
3. **Formatting/Linting**: 
   - Uses conform.nvim for formatting (stylua, ruff, sqlfluff)
   - Uses nvim-lint for linting (selene, ruff, sqlfluff, tflint)
4. **Completion**: nvim-cmp with LSP, buffer, and AI (Windsurf) sources

### Custom Zsh Functions

These are installed to `$HOME/.zsh_functions` and can be called from the command
line.

- `mtp`: Convert Markdown to PDF using Pandoc with XeLaTeX
- `scrib`: Open daily Markdown file for ad-hoc note taking in $EDITOR
- `sweep`: Prune dangling Git branches

## Lua Linting

The repository uses Selene for Lua linting with Neovim standards (configured in `selene.toml`).

## Important Notes

- The Neovim configuration auto-updates plugins on startup
- Format-on-save is enabled by default but can be disabled with `:FormatDisable`
- LSP servers are automatically installed via Mason
- The setup creates symlinks rather than copying files to maintain version control

## Making Git Commits

When making Git commits, never add Claude Code to the commit message.
