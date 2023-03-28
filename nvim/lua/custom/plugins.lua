local plugins = {

  -- Dynamic colour column
  {
    "Bekaboo/deadcolumn.nvim",
    lazy = false
  },

  -- LSP server
  {
    "neovim/nvim-lspconfig",
    dependencies = {
      -- format & linting
      {
        "jose-elias-alvarez/null-ls.nvim",
        config = function()
          require "custom.configs.null-ls"
        end
      }
    },
    config = function()
      require "plugins.configs.lspconfig"
      require "custom.configs.lspconfig"
    end -- Override to setup mason-lspconfig
  },

  -- treesitter config
  {
    "nvim-treesitter/nvim-treesitter",
    opts = {
      ensure_installed = {"c", "lua", "vim", "help", "html", "css", "bash"},
      highlight = {
        enable = true,
        use_languagetree = true,
      },
      indent = { enable = true },
    },
  },

  -- mason.vim
  -- install using :MasonInstallAll
   {
    "williamboman/mason.nvim",
     opts = {
      ensure_installed = {
        -- lua stuff
        "lua-language-server",
        "stylua",

        -- web dev
        "css-lsp",
        "html-lsp",
        "typescript-language-server",
        "deno",
        "emmet-ls",
        "json-lsp",

        -- shell
        "shfmt",
        "shellcheck",

        -- custom
        "autoflake",
        "autopep8",
        "pylint",
        "cfn-lint",
        "sqlfluff",
        "yamllint",
        "terraform-ls",
        "prettier"
      }
    }
  },

  {
    "nvim-tree/nvim-tree.lua",
    opts = {
      git = {
        enable = true,
      },

      renderer = {
        highlight_git = true,
        icons = {
          show = {
            git = true
          }
        }
      }
    }
  },

  -- preview markdown with glow in terminal
  {
    "ellisonleao/glow.nvim",
    -- lazy load when opening markdown files
    ft = {"markdown", "md"},
    config = function()
      require ("glow").setup({
        style = "dracula"
    })
    end
  },

  -- markdown
  {
    "preservim/vim-markdown",
    ft = {"markdown", "md"},
    branch = "master",
    dependencies = {
      "godlygeek/tabular"
    }
  },

  {
    "nvim-neorg/neorg",
    build = ":Neorg sync-parsers",
    ft = "norg",
    opts = {
      load = {
        ["core.defaults"] = {}, -- Loads default behaviour
        ["core.norg.concealer"] = {}, -- Adds pretty icons to your documents,
        ["core.norg.dirman"] = { -- Manages Neorg workspaces
          config = {
            workspaces = {
              notes = "~/Notes"
            }
          }
        }
      }
    },
    dependencies = { { "nvim-lua/plenary.nvim" } }
  }
}

return plugins
