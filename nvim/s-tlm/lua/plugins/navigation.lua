return {
	{
		"nvim-tree/nvim-tree.lua",
		version = "*",
		lazy = false,
		dependencies = {
			"nvim-tree/nvim-web-devicons",
		},
		opts = {
			view = {
				width = {
					min = 30,
					max = -1,
					padding = 1,
				},
			},
			filters = {
				dotfiles = false,
			},
		},
	},
	{
		"nvim-telescope/telescope.nvim",
		version = "*",
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
