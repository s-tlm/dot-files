-- vim options
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.relativenumber = true
vim.g.maplocalleader = ","
vim.opt.colorcolumn = "80"

-- general
lvim.log.level = "OFF"
lvim.format_on_save = {
  enabled = true,
  pattern = "*.lua",
  timeout = 1000,
}

-- keymappings <https://www.lunarvim.org/docs/configuration/keybindings>
lvim.leader = "space"
-- add your own keymapping
lvim.keys.normal_mode["<Tab>"] = ":BufferLineCycleNext<CR>"
lvim.keys.normal_mode["<S-Tab>"] = ":BufferLineCyclePrev<CR>"
lvim.keys.normal_mode["<leader>x"] = ":BufferKill<CR>"
lvim.keys.normal_mode["<leader>kv"] = ":MarkdownPreview<CR>"
-- custom whichkey mappings
lvim.builtin.which_key.mappings["k"] = {
  name = "Markdown Preview",
  v = { "<cmd>MarkdownPreviewToggle<CR>", "Toggle Preview" }
}

-- -- Use which-key to add extra bindings with the leader-key prefix
-- lvim.builtin.which_key.mappings["W"] = { "<cmd>noautocmd w<cr>", "Save without formatting" }
-- lvim.builtin.which_key.mappings["P"] = { "<cmd>Telescope projects<CR>", "Projects" }

-- Change built-ins
lvim.builtin.alpha.active = true
lvim.builtin.alpha.mode = "dashboard"
lvim.builtin.terminal.active = true
lvim.builtin.nvimtree.setup.view.side = "left"
lvim.builtin.nvimtree.setup.renderer.icons.show.git = false
lvim.builtin.nvimtree.setup.view.adaptive_size = true
-- Automatically install missing parsers when entering buffer
lvim.builtin.treesitter.auto_install = true
-- always installed on startup, useful for parsers without a strict filetype
lvim.builtin.treesitter.ensure_installed = {
  "bash",
  "c",
  "cpp",
  "comment",
  "dockerfile",
  "go",
  "json",
  "json5",
  "markdown_inline",
  "markdown",
  "python",
  "r",
  "rnoweb",
  "regex",
  "rust",
  "sql",
  "terraform",
  "yaml",
}

-- generic LSP settings <https://www.lunarvim.org/docs/languages#lsp-support>
---remove a server from the skipped list, e.g. eslint, or emmet_ls. IMPORTANT: Requires `:LvimCacheReset` to take effect
---`:LvimInfo` lists which server(s) are skipped for the current filetype

-- linters, formatters and code actions <https://www.lunarvim.org/docs/languages#lintingformatting>
local linters = require "lvim.lsp.null-ls.linters"
linters.setup {
  { command = "pylint",       filetypes = { "python" } },
  { command = "sqlfluff",     filetypes = { "sql" },           extra_args = { "--dialect", "postgres" } },
  { command = "markdownlint", filetypes = { "md", "markdown" } },
  { command = "shellcheck",   filetypes = { "sh" } },
}
-- disable virtual text
vim.diagnostic.config({ virtual_text = false })

-- Additional Plugins <https://www.lunarvim.org/docs/plugins#user-plugins>
lvim.plugins = {
  {
    "iamcco/markdown-preview.nvim",
    cmd = { "MarkdownPreviewToggle", "MarkdownPreview", "MarkdownPreviewStop" },
    ft = { "markdown" },
    build = function() vim.fn["mkdp#util#install"]() end,
  },
  {
    "scalameta/nvim-metals",
    config = function()
      require("user.metals").config()
    end,
  },
  {
    "zbirenbaum/copilot-cmp",
    cmd = "Copilot",
    event = "InsertEnter",
    dependencies = { "zbirenbaum/copilot.lua" },
    config = function()
      vim.defer_fn(function()
        require("copilot").setup()     -- https://github.com/zbirenbaum/copilot.lua/blob/master/README.md#setup-and-configuration
        require("copilot_cmp").setup() -- https://github.com/zbirenbaum/copilot-cmp/blob/master/README.md#configuration
      end, 100)
    end,
  },
  {
    "folke/twilight.nvim",
    lazy = true,
    config = function()
      require("twilight").setup()
    end,
  },
  {
    -- Ensure plugin is also enabled in treesitter
    "hiphish/rainbow-delimiters.nvim"
  },
  {
    -- catppuccin nvim theme
    "catppuccin/nvim",
    name = "catppuccin",
    opts = {
      flavour = "frappe",
      background = { dark = "frappe" },
      term_colors = true,
      integrations = {
        alpha = true,
        native_lsp = {
          enabled = true,
        },
        gitsigns = true,
        mason = true,
        cmp = true,
        nvimtree = true,
        treesitter = true,
        treesitter_context = true,
        rainbow_delimiters = true,
        telescope = true,
        which_key = true,
      }
    },
  },
}

-- dap configuration
lvim.builtin.dap.active = true
local dap = require("dap")

dap.configurations.scala = {
  {
    type = "scala",
    request = "launch",
    name = "Run or Test Target",
    metals = {
      runType = "runOrTestFile",
    },
  },
  {
    type = "scala",
    request = "launch",
    name = "Test Target",
    metals = {
      runType = "testTarget",
    },
  },
}

-- Enable rainbow in treesitter
lvim.builtin.treesitter.rainbow.enable = true
-- Change theme settings
lvim.colorscheme = "catppuccin"
-- Bufferline and Statusline settings for catppuccin theme
lvim.builtin.bufferline.highlights = require("catppuccin.groups.integrations.bufferline").get()
lvim.builtin.lualine.options.theme = "catppuccin"

-- Autocommands (`:help autocmd`) <https://neovim.io/doc/user/autocmd.html>
-- https://www.reddit.com/r/neovim/comments/125gctj/e5248_invalid_character_in_group_name_with/
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
  pattern = { "*.tfvars" },
  command = "set filetype=terraform"
})
vim.api.nvim_create_autocmd({ "BufRead", "BufNewFile" }, {
  pattern = { "*.sbt" },
  command = "set filetype=scala"
})
