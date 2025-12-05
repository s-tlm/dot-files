return {
	{
		"mason-org/mason.nvim",
		opts = {},
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
				"terraformls",
				"tflint",
				"yamlls",
				"html",
				"cssls",
			},
			automatic_installation = true,
		},
		dependencies = {
			{ "mason-org/mason.nvim", opts = {} },
			"neovim/nvim-lspconfig",
		},
	},
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			{
				"mason-org/mason.nvim",
				opts = {
					PATH = "append",
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

			conform.setup({
				formatters_by_ft = {
					lua = { "stylua" },
					python = {
						-- fixes auto-fixable lint errors
						"ruff_fix",
						-- run the ruff formatter
						"ruff_format",
						-- organise imports
						"ruff_organize_imports",
					},
					sql = { "sqlfluff" },
				},

				formatters = {
					sqlfluff = {
						command = "sqlfluff",
						args = { "format", "$FILENAME", "--dialect", "redshift" },
						stdin = false,
						cwd = function()
							return vim.fn.getcwd()
						end,
					},
				},
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

			lint.linters.sqlfluff.args = {
				"lint",
				"--format=json",
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
		"saghen/blink.cmp",
		dependencies = "rafamadriz/friendly-snippets",
		lazy = true,
		version = "v1.*",
		opts = {
			keymap = {
				preset = "default",
				["<CR>"] = { "accept", "fallback" },
				["<Tab>"] = { "select_next", "snippet_forward", "fallback" },
				["<S-Tab>"] = { "select_prev", "snippet_backward", "fallback" },
			},
			appearance = {
				nerd_font_variant = "mono",
			},
			sources = {
				default = { "lsp", "path", "snippets" },
			},
			completion = {
				menu = {
					draw = {
						components = {
							kind_icon = {
								text = function(ctx)
									local kind_icon, _, _ = require("mini.icons").get("lsp", ctx.kind)
									return kind_icon
								end,
								highlight = function(ctx)
									local _, hl, _ = require("mini.icons").get("lsp", ctx.kind)
									return hl
								end,
							},
							kind = {
								highlight = function(ctx)
									local _, hl, _ = require("mini.icons").get("lsp", ctx.kind)
									return hl
								end,
							},
						},
					},
				},
			},
			signature = {
				enabled = true,
			},
		},
		opts_extend = { "sources.default" },
	},
}
