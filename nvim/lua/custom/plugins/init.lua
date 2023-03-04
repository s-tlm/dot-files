return {
  -- Enable dashboard
  ["goolord/alpha-nvim"] = {
    disable = false,
  },
  -- LSP server
  ["neovim/nvim-lspconfig"] = {
    config = function()
      require "plugins.configs.lspconfig"
      require "custom.plugins.lspconfig"
    end,
  },
  -- mason.vim
  -- install using :MasonInstallAll
   ["williamboman/mason.nvim"] = {
   override_options = {
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
        "autopep8",
        "pylint",
        "cfn-lint",
        "sqlfluff",
        "yamllint",
        "terraform-ls",
        "markdownlint"
      }
    }
  },
  -- load it after nvim-lspconfig cuz we lazy loaded lspconfig
  ["jose-elias-alvarez/null-ls.nvim"] = {
      after = "nvim-lspconfig",
      config = function()
         require "custom.plugins.null-ls"
      end,
 }
}

