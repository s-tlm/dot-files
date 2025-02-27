local alpha = require("alpha")
local builtin = require("telescope.builtin")
local dashboard = require("alpha.themes.dashboard")
local lazy = require("lazy")

dashboard.section.header.val = {
	[[      ___                              ___     ]],
	[[     /\__\                            /\  \    ]],
	[[    /:/ _/_       ___                |::\  \   ]],
	[[   /:/ /\  \     /\__\               |:|:\  \  ]],
	[[  /:/ /::\  \   /:/  /___     ___  __|:|\:\  \ ]],
	[[ /:/_/:/\:\__\ /:/__//\  \   /\__\/::::|_\:\__\]],
	[[ \:\/:/ /:/  //::\  \\:\  \ /:/  /\:\~~\  \/__/]],
	[[  \::/ /:/  //:/\:\  \\:\  /:/  /  \:\  \      ]],
	[[   \/_/:/  / \/__\:\  \\:\/:/  /    \:\  \     ]],
	[[     /:/  /       \:\__\\::/  /      \:\__\    ]],
	[[     \/__/         \/__/ \/__/        \/__/    ]],
}

-- set dashboard buttons
dashboard.section.buttons.val = {
	dashboard.button("e", "  > New file", ":ene <BAR> startinsert <CR>"),
	dashboard.button("o", "󰌑  > Open recent", ":Telescope oldfiles<CR>"),
	dashboard.button("<leader>sf", "  > Search files", builtin.find_files),
	dashboard.button("<leader>st", "󱩾  > Search text", builtin.live_grep),
	dashboard.button("<leader>sb", "  > Search buffers", builtin.buffers),
	dashboard.button("<leader>sb", "󰞋  > Search help", builtin.help_tags),
	dashboard.button("q", "󰩈  > Quit NVIM", ":qa<CR>"),
}

local function footer()
	local total_plugins = lazy.stats().count
	local datetime = os.date(" %d-%m-%Y   %H:%M:%S")
	local version = vim.version()
	local nvim_version_info = "   v" .. version.major .. "." .. version.minor .. "." .. version.patch

	return datetime .. "   " .. total_plugins .. " plugins" .. nvim_version_info
end

dashboard.section.footer.val = footer()

-- send config to alpha
alpha.setup(dashboard.opts)
