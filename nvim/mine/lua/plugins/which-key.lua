return {
	{
	  "folke/which-key.nvim",
	  event = "VeryLazy",
	  opts = {
		  spec = {
			  { "<leader>pi", ":Lazy<CR>", { desc = "Show Lazy UI" } },
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
