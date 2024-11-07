return {
	{
		"Exafunction/codeium.nvim",
		event = "BufEnter",
		build = ":Codeium Auth",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"hrsh7th/nvim-cmp",
		},
		config = function()
			require("codeium").setup({
				enable_cmp_source = false,
				virtual_text = {
					enabled = true,
					key_bindings = {
						-- Clear the virtual_text.
						clear = "<C-e>",
						-- Cycle to the next completion.
						next = "<M-]>",
						-- Cycle to the previous completion.
						prev = "<M-[>",
					},
				},
			})
		end,
	},
}
