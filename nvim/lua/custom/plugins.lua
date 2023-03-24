local plugins = {

  -- Enable starting dashboard
  { "goolord/alpha-nvim", lazy = false },

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
    lazy = false,
    config = function()
      require ("glow").setup({
        style = "dracula"
    })
    end
  }
}

return plugins
