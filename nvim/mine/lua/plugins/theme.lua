return {
	{
		"catppuccin/nvim",
		lazy = false,
		name = "catppuccin",
		priority = 1000,
		opts = {
			flavour = "frappe",
			integration = {
				gitsigns = true,
				illuminate = { enabled = true },
				telescope = { enabled = true },
				treesitter = true,
				which_key = true,
			},
		},
		config = function()
			-- load the colourscheme
			vim.cmd([[colorscheme catppuccin]])
		end,
	},
	{ "RRethy/vim-illuminate" },
	{ "HiPhish/rainbow-delimiters.nvim" },
	{
		"lewis6991/gitsigns.nvim",
		opts = {},
	},
}
