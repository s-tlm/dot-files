local alpha = require("alpha")
local builtin = require("telescope.builtin")
local dashboard = require("alpha.themes.dashboard")

dashboard.section.header.val = {
	"                                                    ",
	" ███╗   ██╗███████╗ ██████╗ ██╗   ██╗██╗███╗   ███╗ ",
	" ████╗  ██║██╔════╝██╔═══██╗██║   ██║██║████╗ ████║ ",
	" ██╔██╗ ██║█████╗  ██║   ██║██║   ██║██║██╔████╔██║ ",
	" ██║╚██╗██║██╔══╝  ██║   ██║╚██╗ ██╔╝██║██║╚██╔╝██║ ",
	" ██║ ╚████║███████╗╚██████╔╝ ╚████╔╝ ██║██║ ╚═╝ ██║ ",
	" ╚═╝  ╚═══╝╚══════╝ ╚═════╝   ╚═══╝  ╚═╝╚═╝     ╚═╝ ",
	"                                                    ",
}

-- set dashboard buttons
dashboard.section.buttons.val = {
	dashboard.button("e", "  > New file", ":ene <BAR> startinsert <CR>"),
	dashboard.button("<leader>sf", "  > Find files", builtin.find_files),
	dashboard.button("q", "󰩈  > Quit NVIM", ":qa<CR>"),
}

-- dashboard.section.buttons.val = {
-- 	dashboard.button("e", "  > New file", ":ene <BAR> startinsert <CR>"),
-- 	dashboard.button("r", "  > Recent", ":Telescope oldfiles<CR>"),
-- }

-- send config to alpha
alpha.setup(dashboard.opts)
