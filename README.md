# Dot files

## Pre-requisites

1. zsh + oh-my-zsh
2. starship
3. neovim
4. A Nerd Font
5. [bat](https://github.com/sharkdp/bat)
6. [eza](https://github.com/eza-community/eza)
7. [delta](https://github.com/dandavison/delta)
8. [catppuccin-zsh](https://github.com/catppuccin/zsh-syntax-highlighting)
9. [fzf](https://github.com/junegunn/fzf)
10. [zsh-syntax-highlighting](https://github.com/zsh-users/zsh-syntax-highlighting)
11. [zsh-autosuggestions](https://github.com/zsh-users/zsh-autosuggestions)
12. [zsh-interactive-cd](https://github.com/changyuheng/zsh-interactive-cd)
13. Rust (for Cargo)

## Setup

1. Run `scripts/create-symlinks.sh`.
2. Run `scripts/create-zsh-functions.sh`.

## Zsh Configuration

### Oh My Zsh Settings

- Auto-update enabled (every 60 days)
- Minimal verbose output
- Aliases disabled globally but enabled for plugins

### Additional Features

- **Vi Mode**: Enabled with `set -o vi`
- **Path Management**: Rust Cargo binaries added to PATH
- **Starship Prompt**: Modern cross-shell prompt
- **FZF Integration**: Fuzzy finder key bindings and completion
- **Syntax Highlighting**: Catppuccin Frappe theme with zsh-syntax-highlighting
- **Terraform Completion**: Tab completion for Terraform commands

### Neovim Setup

#### Plugins

##### AI

- [codeium.nvim](https://github.com/Exafunction/codeium.nvim)

##### UI

- [alpha-nvim](https://github.com/goolord/alpha-nvim)
- [Catpuccin Frappe](https://github.com/catppuccin/nvim)
- [lualine.nvim](https://github.com/nvim-lualine/lualine.nvim)
- [vim-illuminate](https://github.com/RRethy/vim-illuminate)
- [rainbow-delimiters](https://github.com/HiPhish/rainbow-delimiters.nvim)
- [indent-blankline.nvim](https://github.com/lukas-reineke/indent-blankline.nvim)
- [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons)

##### Navigation

- [nvim-tree](https://github.com/nvim-tree/nvim-tree.lua)
- [which-key.nvim](https://github.com/folke/which-key.nvim)
- [telescope.nvim](https://github.com/nvim-telescope/telescope.nvim)
- [telescope-fzf-native.nvim](https://github.com/nvim-telescope/telescope-fzf-native.nvim)

##### Package Management

- [lazy.nvim](https://github.com/folke/lazy.nvim)
- [mason.nvim](https://github.com/williamboman/mason.nvim)

##### Language Server Protocol (LSP)

- [nvim-lspconfig](https://github.com/neovim/nvim-lspconfig)
- [mason-lspconfig.nvim](https://github.com/williamboman/mason-lspconfig.nvim)
- [nvim-cmp](https://github.com/hrsh7th/nvim-cmp)

##### Linting & Formatting

- [conform.nvim](https://github.com/stevearc/conform.nvim)
- [nvim-lint](https://github.com/mfussenegger/nvim-lint)
- [nvim-autopairs](https://github.com/windwp/nvim-autopairs)
- [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter)
- [nvim-surround](https://github.com/kylechui/nvim-surround)

##### Git

- [gitsigns.nvim](https://github.com/lewis6991/gitsigns.nvim)

##### Debugging

- [nvim-dap](https://github.com/mfussenegger/nvim-dap)
- [nvim-dap-ui](https://github.com/rcarriga/nvim-dap-ui)

##### Misc

- [plenary.nvim](https://github.com/nvim-lua/plenary.nvim)


## Key Maps

- <kbd>CTRL-]</kbd> in Normal mode maps to "go to definition"
- <kbd>grn</kbd> in Normal mode maps to `vim.lsp.buf.rename()`
- <kbd>grr</kbd> in Normal mode maps to `vim.lsp.buf.references()`
- <kbd>gra</kbd> in Normal and Visual mode maps to `vim.lsp.buf.code_action()`
- <kbd>CTRL-S</kbd> in Insert mode maps to `vim.lsp.buf.signature_help()`
