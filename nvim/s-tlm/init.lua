require("config")

-- disable netrw for nvmi-tree
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

-- enable nvim-treesitter highlighting for these file types
vim.api.nvim_create_autocmd("FileType", {
	group = vim.api.nvim_create_augroup("treesitter_highlight", { clear = true }),
	pattern = {
		"bash",
		"sh",
		"hcl",
		"json",
		"jsonc",
		"lua",
		"python",
		"sql",
		"terraform",
		"terraform-vars",
		"yaml",
	},
	callback = function()
		vim.treesitter.start()
	end,
})
