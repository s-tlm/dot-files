return {
	{
		"folke/which-key.nvim",
		event = "VeryLazy",
		opts = {
			spec = {
				{ "<leader>p", group = "Lazy" },
				{ "<leader>L", group = "Mason" },
				{ "<leader>l", group = "LSP" },
				{ "<leader>s", group = "Fuzzy Search" },
				{ "<leader>d", group = "Diagnostics" },
				{ "<leader>k", group = "Markdown" },
				{ "<leader>t", group = "Tabs" },
			},
		},
		keys = {
			{
				"<leader>?",
				function()
					require("which-key").show({ global = false })
				end,
				desc = "Buffer Local Keymaps (which-key)",
			},
		},
	},
}
