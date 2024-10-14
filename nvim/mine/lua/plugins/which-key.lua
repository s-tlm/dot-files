return {
	{
	  "folke/which-key.nvim",
	  event = "VeryLazy",
	  opts = {
		  spec = {
			  { "<leader>pi", ":Lazy<CR>", { desc = "Show Lazy UI" } },
			  { "<leader>e", ":NvimTreeToggle<CR>", {desc = "Toggle navigation tree"} }
		  },
	  },
	  keys = {
		{
		  "<leader>?",
		  function()
			require("which-key").show({ global = false })
		  end,
		  desc = "Buffer Local Keymaps (which-key)",
		},
	  },
	}
}
