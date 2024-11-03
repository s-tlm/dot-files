local builtin = require("telescope.builtin")

return {
	{
		"folke/which-key.nvim",
		event = "VeryLazy",
		opts = {
			spec = {
				{ "<leader>p", group = "Lazy" },
				{ "<leader>pi", ":Lazy<CR>", desc = "Show Lazy UI" },
				{ "<leader>e", ":NvimTreeToggle<CR>", desc = "Toggle navigation tree" },
				{ "<leader>sf", builtin.find_files, { desc = "Telescope search files" } },
				{ "<leader>st", builtin.live_grep, { desc = "Telescope search text" } },
				{ "<leader>sb", builtin.buffers, { desc = "Telescope search buffers" } },
				{ "<leader>sh", builtin.help_tags, { desc = "Telescope search help tags" } },
				{ "<leader>L", group = "Mason" },
				{ "<leader>Li", ":Mason<CR>", desc = "Launch Mason GUI" },
				{ "<leader>Lu", ":MasonUpdate<CR>", desc = "Update all Mason managed registries" },
				{ "<leader>l", group = "Conform" },
				{ "<leader>s", group = "Fuzzy Search" },
				{ "<leader>sb", desc = "Search buffer" },
				{ "<leader>sh", desc = "Search help" },
				{ "<leader>sf", desc = "Search file" },
				{ "<leader>st", desc = "Search test" },
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
