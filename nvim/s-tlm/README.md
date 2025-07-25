# Neovim Configuration

A comprehensive Neovim configuration using Lua with modern plugins for an
IDE-like experience.

## Overview

This configuration uses [lazy.nvim](https://github.com/folke/lazy.nvim) as the
plugin manager with a modular structure organized by functionality. The setup
includes LSP support, AI-powered completion, advanced navigation, and a
beautiful UI.

## Key Features

- **Leader Keys**: Space (leader), Comma (local leader)
- **Auto-updating plugins** on startup
- **Multi-language LSP support** with automatic server installation
- **AI-powered code completion** via Windsurf/Codeium
- **Advanced fuzzy finding** with Telescope
- **Format-on-save** with multiple formatters
- **Real-time linting** for multiple languages

## Plugin Categories

### 🤖 AI Integration (`plugins/ai.lua`)

#### Windsurf.nvim (Codeium)

- **Purpose**: AI-powered code completion with inline suggestions
- **Configuration**:
  - Virtual text completions enabled
  - Accept suggestions: `<Tab>`
  - Clear suggestions: `<C-e>`
  - Cycle next/previous: `<M-]>` / `<M-[>`
  - Integrated into lualine status bar
- **Setup**: Requires `:Codeium Auth` command on first use

### 🎨 UI & Theme (`plugins/ui.lua`)

#### Catppuccin

- **Purpose**: Main colorscheme with extensive integration support
- **Configuration**: Frappe flavor with custom integrations for gitsigns,
  telescope, treesitter, which-key, and indent guides

#### Lualine

- **Purpose**: Customizable status line
- **Configuration**: 
  - Uses Catppuccin theme
  - Shows Codeium status in status line
  - Displays encoding, file format, and file type

#### Alpha-nvim

- **Purpose**: Dashboard/start screen
- **Configuration**: 
  - ASCII art header
  - Quick action buttons for common tasks
  - Dynamic footer showing date, plugin count, and Neovim version

#### Additional UI Plugins

- **Vim-illuminate**: Highlights word under cursor and matching instances
- **Rainbow-delimiters**: Colorizes matching brackets and delimiters
- **Indent-blankline**: Shows indentation guides with scope highlighting
- **Gitsigns**: Git status indicators in sign column
- **Mini.icons**: Modern icon support

### 🧭 Navigation (`plugins/navigation.lua`)

#### Nvim-tree

- **Purpose**: File explorer sidebar
- **Configuration**:
  - Width: 50 characters
  - Shows dotfiles
  - Replaces netrw (disabled in init.lua)
- **Keybinding**: `<leader>e` to toggle

#### Telescope

- **Purpose**: Fuzzy finder for files, text, buffers, and more
- **Configuration**:
  - FZF integration for performance
  - Searches hidden files (excludes .git)
  - Uses ripgrep for file and text searching
- **Keybindings**:
  - `<leader>sf`: Find files
  - `<leader>st`: Live grep (search text)
  - `<leader>sb`: Search buffers
  - `<leader>sh`: Search help tags

### ✏️ Editor Features (`plugins/editor.lua`)

#### Comment.nvim

- **Purpose**: Smart commenting/uncommenting
- **Configuration**: Default settings with automatic language detection

#### Nvim-surround

- **Purpose**: Manipulate surrounding characters (quotes, brackets, etc.)
- **Configuration**: Default keybindings for adding, changing, deleting
  surrounds

#### Markdown-preview

- **Purpose**: Live markdown preview in browser
- **Configuration**: 
  - Lazy-loaded for markdown files
  - Build command uses yarn
- **Keybinding**: `<leader>kv` to toggle preview

### 🔧 LSP & Development (`plugins/lsp.lua`)

#### Language Server Protocol Stack

- **Nvim-lspconfig**: Core LSP client configuration
- **Mason**: Automatic LSP server installation and management
- **Mason-lspconfig**: Bridge between Mason and lspconfig

#### Supported Languages & Servers

- **Bash**: bashls
- **Docker**: dockerls, docker_compose_language_service
- **JSON**: jsonls
- **Lua**: lua_ls with Neovim-specific configuration
- **Python**: basedpyright, ruff
- **SQL**: sqlls
- **Terraform**: terraformls, tflint
- **YAML**: yamlls
- **HTML/CSS**: html, cssls

#### Code Completion (nvim-cmp)

- **Sources**: LSP, buffer, path, cmdline, LuaSnip, Codeium
- **Configuration**:
  - Bordered completion and documentation windows
  - Smart Tab/S-Tab navigation
  - Enter to confirm with replace behavior

#### Formatting (Conform.nvim)

- **Purpose**: Code formatting with multiple formatter support
- **Formatters**:
  - Lua: stylua
  - Python: ruff
  - SQL: sqlfluff
- **Features**:
  - Format-on-save enabled by default
  - Commands to disable/enable globally
  - LSP fallback when formatter unavailable

#### Linting (nvim-lint)

- **Purpose**: Real-time code linting
- **Linters**:
  - Lua: selene
  - Python: ruff
  - SQL: sqlfluff
  - Terraform: tflint
- **Triggers**: On buffer enter, write, and insert leave

#### Additional Development Tools

- **Treesitter**: Advanced syntax highlighting and code parsing
- **Autopairs**: Automatic bracket/quote pairing
- **LuaSnip**: Snippet engine with regex support

### 🔍 Which-key (`plugins/which-key.lua`)

#### Purpose

Displays available keybindings in popup menus for discoverability

#### Organized Groups

- `<leader>p`: Lazy plugin management
- `<leader>L`: Mason LSP management  
- `<leader>l`: Conform formatting controls
- `<leader>s`: Telescope fuzzy search functions
- `<leader>d`: Diagnostic functions
- `<leader>k`: Markdown tools

## Key Bindings

### Buffer Navigation

- `<C-S-l>`: Next buffer
- `<C-S-h>`: Previous buffer

### Plugin Management

- `<leader>pi`: Show Lazy UI
- `<leader>pu`: Update all plugins

### File Navigation

- `<leader>e`: Toggle nvim-tree

### Search (Telescope)

- `<leader>sf`: Search files
- `<leader>st`: Search text (live grep)
- `<leader>sb`: Search buffers
- `<leader>sh`: Search help tags

### LSP Management

- `<leader>Li`: Launch Mason GUI
- `<leader>Lu`: Update Mason registries

### Formatting

- `<leader>li`: Show formatter info
- `<leader>lf`: Disable auto-formatting
- `<leader>lF`: Enable auto-formatting

### Diagnostics

- `<leader>ds`: Show diagnostic float

### LSP Defaults

- `<C-]>`: Go to definition
- `grn`: Rename symbol
- `grr`: Show references
- `gra`: Code actions
- `<C-s>` (Insert): Signature help

## Configuration Structure

```
lua/
├── config/
│   ├── init.lua          # Module loader
│   ├── lazy.lua          # Plugin manager setup
│   ├── lsp.lua           # LSP and completion configuration
│   ├── general.lua       # Vim options and settings
│   ├── keybinds.lua      # Custom keybindings
│   ├── telescope.lua     # Telescope configuration
│   └── alpha.lua         # Dashboard configuration
└── plugins/
    ├── ai.lua            # AI/Codeium configuration
    ├── ui.lua            # Theme and UI plugins
    ├── navigation.lua    # File navigation plugins
    ├── editor.lua        # Editor enhancement plugins
    ├── lsp.lua           # LSP and development plugins
    └── which-key.lua     # Keybinding help configuration
```

## Vim Settings

- **Line numbers**: Enabled with relative numbers
- **Search**: Case-insensitive with smart case, no highlight
- **Indentation**: 4 spaces for tab and shift width
- **Color column**: Set at 80 characters
- **Diagnostics**: Virtual text disabled (use `<leader>ds` to show)

## Auto-features

- **Plugin updates**: Automatic on startup if updates available
- **Format on save**: Enabled globally (can be disabled)
- **LSP server installation**: Automatic via Mason
- **Linting**: Triggered on buffer events
- **Completion**: Real-time with multiple sources

## Dependencies

- **Neovim**: 0.8+ (built for latest stable)
- **Git**: Required for plugin management
- **Node.js & Yarn**: For markdown-preview plugin
- **Build tools**: Make, C compiler (for some plugins)
- **External tools**: ripgrep, fd (for Telescope performance)

## Installation

1. Ensure Neovim 0.8+ is installed
2. Clone/symlink this configuration to `~/.config/nvim`
3. Launch Neovim - lazy.nvim will automatically install plugins
4. Run `:Codeium Auth` for AI completion setup
5. Restart Neovim to complete setup

The configuration will automatically install and configure all necessary LSP
servers, formatters, and linters on first run.