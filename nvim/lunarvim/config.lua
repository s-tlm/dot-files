-- vim options
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.relativenumber = true
vim.g.maplocalleader = ","

-- general
lvim.log.level = "info"
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

-- -- Use which-key to add extra bindings with the leader-key prefix
-- lvim.builtin.which_key.mappings["W"] = { "<cmd>noautocmd w<cr>", "Save without formatting" }
-- lvim.builtin.which_key.mappings["P"] = { "<cmd>Telescope projects<CR>", "Projects" }

-- -- Change theme settings
lvim.colorscheme = "lunar"
lvim.transparent_window = true

lvim.builtin.alpha.active = true
lvim.builtin.alpha.mode = "dashboard"
lvim.builtin.terminal.active = true
lvim.builtin.nvimtree.setup.view.side = "left"
lvim.builtin.nvimtree.setup.renderer.icons.show.git = false

-- Automatically install missing parsers when entering buffer
lvim.builtin.treesitter.auto_install = true

-- lvim.builtin.treesitter.ignore_install = { "haskell" }

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
  "python",
  "regex",
  "rust",
  "sql",
  "terraform",
  "yaml",
}

-- generic LSP settings <https://www.lunarvim.org/docs/languages#lsp-support>
---remove a server from the skipped list, e.g. eslint, or emmet_ls. IMPORTANT: Requires `:LvimCacheReset` to take effect
---`:LvimInfo` lists which server(s) are skipped for the current filetype
lvim.lsp.automatic_configuration.skipped_servers = vim.tbl_filter(function(server)
  return server ~= "sqlls"
end, lvim.lsp.automatic_configuration.skipped_servers)

-- linters, formatters and code actions <https://www.lunarvim.org/docs/languages#lintingformatting>
local linters = require "lvim.lsp.null-ls.linters"
linters.setup {
  { command = "pylint",       filetypes = { "python" } },
  { command = "sqlfluff",     filetypes = { "sql" },           extra_args = { "--dialect", "postgres" } },
  { command = "markdownlint", filetypes = { "md", "markdown" } },
}
-- disable virtual text
vim.diagnostic.config({ virtual_text = false })

-- Additional Plugins <https://www.lunarvim.org/docs/plugins#user-plugins>
lvim.plugins = {
  {
    "nvim-neorg/neorg",
    ft = "norg", -- lazy-load on filetype
    build = ":Neorg sync-parsers",
    opts = {
      load = {
        ["core.defaults"] = {},  -- Loads default behaviour
        ["core.concealer"] = {}, -- Adds pretty icons to your documents
        ["core.dirman"] = {      -- Manages Neorg workspaces
          config = {
            workspaces = {
              notes = "~/Notes"
            }
          }
        }
      }
    },
    dependencies = { { "nvim-lua/plenary.nvim" } },
  },
  {
    "preservim/vim-markdown",
    ft = { "markdown", "md" },
    branch = "master",
    dependencies = {
      "godlygeek/tabular"
    }
  },
  {
    -- Ensure plugin is also enabled in treesitter
    "HiPhish/nvim-ts-rainbow2"
  },
}
-- Enable rainbow in treesitter
lvim.builtin.treesitter.rainbow.enable = true
lvim.builtin.treesitter.rainbow.strategy = require('ts-rainbow').strategy.global

-- Autocommands (`:help autocmd`) <https://neovim.io/doc/user/autocmd.html>
-- Neorg concealer settings
vim.api.nvim_create_autocmd({ "BufEnter", "BufWinEnter" }, {
  pattern = { "*.norg" },
  command = "set conceallevel=2 | set concealcursor=nc"
})
