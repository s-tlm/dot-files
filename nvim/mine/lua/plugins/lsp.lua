return {
	{
		"neovim/nvim-lspconfig",
		dependencies = {
			{
				"williamboman/mason.nvim",
				config = function()
					require("mason").setup()
				end,
			},
			{
				"williamboman/mason-lspconfig.nvim",
				config = function()
					require("mason-lspconfig").setup({
						ensure_installed = {
							"bashls",
							"dockerls",
							"docker_compose_language_service",
							"jsonls",
							"lua_ls",
							"pyright",
							"ruff",
							"sqlls",
							"terraformls",
							"tflint",
							"vale_ls",
							"yamlls",
						},
						automatic_installation = true,
					})
				end,
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
		config = function()
			require("nvim-surround").setup()
		end,
	},
	{
		"stevearc/conform.nvim",
		event = { "BufReadPre", "BufNewFile" },
		config = function()
			local conform = require("conform")
			local format_settings = {
				lsp_fallback = true,
				async = false,
				timeout_ms = 500,
			}

			conform.setup({
				formatters_by_ft = {
					lua = { "stylua" },
					python = { "isort", "black" },
					sql = { "sqlfmt" },
				},

				format_on_save = format_settings,

				vim.keymap.set({ "n", "v" }, "<leader>ff", function()
					conform.format(format_settings)
				end, { desc = "Format file or range (in visual mode)" }),
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

			vim.keymap.set("n", "<leader>l", function()
				lint.try_lint()
			end, { desc = "Trigger linting for current file" })
		end,
	},
}
