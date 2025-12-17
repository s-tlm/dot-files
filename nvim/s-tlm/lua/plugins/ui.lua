local lint_progress = function()
	local linters = require("lint").get_running()
	if #linters == 0 then
		return "󰦕"
	end
	return "󱉶 " .. table.concat(linters, ", ")
end

return {
	{
		"catppuccin/nvim",
		lazy = false,
		name = "catppuccin",
		priority = 1000,
		opts = {
			flavour = "frappe",
			transparent_background = true,
			integration = {
				gitsigns = true,
				illuminate = { enabled = true },
				telescope = { enabled = true },
				treesitter = true,
				which_key = true,
				indent_blankline = {
					enabled = true,
					scope_color = "lavender",
					colored_indent_levels = true,
				},
			},
		},
	},
	{ "RRethy/vim-illuminate" },
	{ "HiPhish/rainbow-delimiters.nvim" },
	{
		"lewis6991/gitsigns.nvim",
		opts = {},
	},
	{
		"lukas-reineke/indent-blankline.nvim",
		main = "ibl",
		opts = {},
	},
	{
		"nvim-lualine/lualine.nvim",
		dependencies = {
			{ "nvim-tree/nvim-web-devicons" },
		},
		opts = {
			options = {
				theme = "catppuccin-frappe",
			},
			sections = {
				lualine_x = {
					"require('codeium.virtual_text').status_string()",
					"encoding",
					"fileformat",
					"filetype",
				},
				lualine_y = {
					lint_progress,
				},
			},
		},
	},
	{ "echasnovski/mini.icons", opts = {}, version = false },
	{ "goolord/alpha-nvim" },
}
