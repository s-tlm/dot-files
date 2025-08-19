local wk = require("which-key")
local builtin = require("telescope.builtin")

wk.add({
	{ "<C-S-l>", ":bnext<CR>", desc = "Next buffer" },
	{ "<C-S-h>", ":bprevious<CR>", desc = "Previous buffer" },
	{ "<leader>tn", ":tabnext<CR>", desc = "Next tab" },
	{ "<leader>tp", ":tabprevious<CR>", desc = "Previous tab" },
	{ "<leader>to", ":tabnew<CR>", desc = "Open new tab" },
	{ "<leader>tc", ":tabclose<CR>", desc = "Close current tab" },
	{ "<leader>pi", ":Lazy<CR>", desc = "Show Lazy UI" },
	{ "<leader>pu", ":Lazy update<CR>", desc = "Update Lazy plugins" },
	{ "<leader>e", ":NvimTreeToggle<CR>", desc = "Toggle navigation tree" },
	{ "<leader>sf", builtin.find_files, { desc = "Telescope search files" } },
	{ "<leader>st", builtin.live_grep, { desc = "Telescope search text" } },
	{ "<leader>sb", builtin.buffers, { desc = "Telescope search buffers" } },
	{ "<leader>sh", builtin.help_tags, { desc = "Telescope search help tags" } },
	{ "<leader>Li", ":Mason<CR>", desc = "Launch Mason GUI" },
	{ "<leader>Lu", ":MasonUpdate<CR>", desc = "Update all Mason managed registries" },
	{ "<leader>li", ":ConformInfo<CR>", desc = "See formatter information" },
	{ "<leader>lI", ":LspInfo<CR>", desc = "See LSP information for the current buffer" },
	{ "<leader>lf", ":FormatDisable<CR>", desc = "Disable Conform auto-formatting globally" },
	{ "<leader>lF", ":FormatEnable<CR>", desc = "Enable Conform auto-formatting globally" },
	{ "<leader>sb", desc = "Search buffer" },
	{ "<leader>sh", desc = "Search help" },
	{ "<leader>sf", desc = "Search file" },
	{ "<leader>st", desc = "Search text" },
	{
		"<leader>ds",
		function()
			local config = vim.diagnostic.config()
			if config.virtual_text == false then
				vim.diagnostic.config({ virtual_text = true })
				print("Diagnostic virtual text enabled")
			else
				vim.diagnostic.config({ virtual_text = false })
				print("Diagnostic virtual text disabled")
			end
		end,
		desc = "Toggle diagnostic virtual text",
	},
})
