return {
	{
		"catppuccin/nvim",
		lazy = false,
		name = "catppuccin",
		priority = 1000,
		opts = {
			flavour = "frappe",
			integration = {
				which_key = true,
			}
		},
		config = function()
			-- load the colourscheme
			vim.cmd([[colorscheme catppuccin]])
		end,
	},
	{
		"nvim-tree/nvim-web-devicons",
	},
}
