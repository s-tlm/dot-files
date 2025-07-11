return {
	{
		"nvim-tree/nvim-tree.lua",
		version = "*",
		lazy = false,
		dependencies = {
			"nvim-tree/nvim-web-devicons",
		},
		opts = {
			view = { width = 50 },
			filters = {
				dotfiles = false,
			},
		},
	},
	{
		"nvim-telescope/telescope.nvim",
		tag = "0.1.8",
		dependencies = { "nvim-lua/plenary.nvim" },
	},
	{
		"nvim-lua/plenary.nvim",
		lazy = true,
	},
	{
		"nvim-telescope/telescope-fzf-native.nvim",
		build = "make",
	},
}
