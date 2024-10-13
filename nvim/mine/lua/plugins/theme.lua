return {
	{
		"catppuccin/nvim",
		lazy = false,
		name = "catppuccin",
		priority = 1000,
		opts = {
			flavour = "frappe",
			transparent_background = true,
		},
		config = function()
			-- load the colourscheme
			vim.cmd([[colorscheme catppuccin]])
		end,
	},
}