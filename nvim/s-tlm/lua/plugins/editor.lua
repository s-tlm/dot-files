return {
	{
		"numToStr/Comment.nvim",
		opts = {},
	},
	{
		"kylechui/nvim-surround",
		version = "*", -- Use for stability; omit to use `main` branch for the latest features
		event = "VeryLazy",
		opts = {},
	},
	{
		"iamcco/markdown-preview.nvim",
		cmd = { "MarkdownPreviewToggle", "MarkdownPreview", "MarkdownPreviewStop" },
		build = "cd app && yarn install",
		init = function()
			vim.g.mkdp_filetypes = { "markdown" }
		end,
		ft = { "markdown" },
		keys = {
			{ "<leader>kv", "<cmd>MarkdownPreviewToggle<CR>", desc = "Preview Markdown toggle" },
		},
	},
}
