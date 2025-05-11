return {
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			{
				"mason-org/mason.nvim",
				opts = {
					PATH = "append",
				},
			},
			{
				"mason-org/mason-lspconfig.nvim",
				opts = {
					ensure_installed = {
						"bashls",
						"dockerls",
						"docker_compose_language_service",
						"jsonls",
						"lua_ls",
						"basedpyright",
						"ruff",
						"sqlls",
						"terraformls",
						"tflint",
						"yamlls",
						"html",
						"cssls",
					},
					automatic_installation = true,
				},
			},
		},
	},
	{
		"windwp/nvim-autopairs",
		event = "InsertEnter",
		config = true,
	},
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		config = function()
			local configs = require("nvim-treesitter.configs")

			configs.setup({
				ensure_installed = {
					"bash",
					"json",
					"jsonc",
					"lua",
					"luadoc",
					"markdown",
					"markdown_inline",
					"python",
					"sql",
					"terraform",
					"hcl",
					"yaml",
				},
				auto_install = true,
				highlight = {
					enable = true,
					disable = { "markdown" },
				},
			})
		end,
	},
	{
		"kylechui/nvim-surround",
		version = "*", -- Use for stability; omit to use `main` branch for the latest features
		event = "VeryLazy",
		opts = {},
	},
	{
		"stevearc/conform.nvim",
		event = { "BufReadPre", "BufNewFile" },
		config = function()
			local conform = require("conform")
			local format_settings = {
				lsp_fallback = true,
				async = false,
				timeout_ms = 1000,
			}

			conform.setup({
				formatters_by_ft = {
					lua = { "stylua" },
					python = { "isort", "ruff" },
					sql = { "sqlfmt" },
				},

				format_on_save = format_settings,
			})
		end,
	},
	{
		"mfussenegger/nvim-lint",
		event = { "BufReadPre", "BufNewFile" },
		config = function()
			local lint = require("lint")

			lint.linters_by_ft = {
				lua = { "selene" },
				python = { "ruff" },
				sql = { "sqlfluff" },
				terraform = { "tflint" },
			}

			local lint_augroup = vim.api.nvim_create_augroup("lint", { clear = true })

			vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost", "InsertLeave" }, {
				group = lint_augroup,
				callback = function()
					lint.try_lint()
				end,
			})
		end,
	},
	{
		"L3MON4D3/LuaSnip",
		version = "v2.*",
		build = "make install_jsregexp",
	},
	{
		"hrsh7th/nvim-cmp",
		event = { "InsertEnter", "CmdlineEnter" },
		dependencies = {
			{ "neovim/nvim-lspconfig" },
			{ "hrsh7th/cmp-nvim-lsp" },
			{ "hrsh7th/cmp-buffer" },
			{ "hrsh7th/cmp-path" },
			{ "hrsh7th/cmp-cmdline" },
			{ "L3MON4D3/LuaSnip" },
			{ "saadparwaiz1/cmp_luasnip" },
		},
	},
}
