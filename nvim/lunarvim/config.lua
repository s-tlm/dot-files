-- TODO
-- * Fix Bufferline to use Catppuccin theme

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

-- Change built-ins
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
        ["core.dirman"] = {      -- Manages Neorg worksp"<leader>za", ":TZAtaraxis<CR>"a"<leader>za", ":TZAtaraxis<CR>"ces
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
    "Pocco81/true-zen.nvim",
    opts = {
      modes = {
        ataraxis = {
          minimum_writing_area = {
            width = 120
          },
          callbacks = {
            open_pre = function()
              require("lualine").hide()
            end,
            close_pre = function()
              require("lualine").hide({ unhide = true })
            end,
          },
        },
      },
      integrations = {
        twilight = true,
      },
    },
    keys = {
      { "<leader>zm", ":TZAtaraxis<CR>", desc = "Toggle Zen Mode" },
    },
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
    "HiPhish/nvim-ts-rainbow2"
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
        ts_rainbow2 = true,
        telescope = true,
        which_key = true,
      }
    },
  },
}
-- Enable rainbow in treesitter
lvim.builtin.treesitter.rainbow.enable = true
lvim.builtin.treesitter.rainbow.strategy = require('ts-rainbow').strategy.global
-- Change theme settings
lvim.colorscheme = "catppuccin"
-- Statusline settings for catppuccin theme
lvim.builtin.lualine.options.theme = "catppuccin"

-- Autocommands (`:help autocmd`) <https://neovim.io/doc/user/autocmd.html>
-- Neorg concealer settings
vim.api.nvim_create_autocmd({ "BufEnter", "BufWinEnter" }, {
  pattern = { "*.norg" },
  command = "set conceallevel=2 | set concealcursor=nc"
})
