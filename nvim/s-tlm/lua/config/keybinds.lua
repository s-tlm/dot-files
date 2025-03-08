local wk = require("which-key")
local builtin = require("telescope.builtin")

wk.add({
	{ "<C-S-l>", ":bnext<CR>", desc = "Next buffer" },
	{ "<C-S-h>", ":bprevious<CR>", desc = "Previous buffer" },
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
	{ "<leader>lf", ":FormatDisable<CR>", desc = "Disable Conform auto-formatting globally" },
	{ "<leader>lF", ":FormatEnable<CR>", desc = "Enable Conform auto-formatting globally" },
	{ "<leader>sb", desc = "Search buffer" },
	{ "<leader>sh", desc = "Search help" },
	{ "<leader>sf", desc = "Search file" },
	{ "<leader>st", desc = "Search text" },
	{
		"<leader>ds",
		function()
			vim.diagnostic.open_float()
		end,
		desc = "Show diagnostics",
	},
})
