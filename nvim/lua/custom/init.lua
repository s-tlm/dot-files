local opt = vim.opt
local cmd = vim.cmd
local g = vim.g

-- Numbers
opt.relativenumber = true

-- Color lines
opt.colorcolumn = "80"
opt.textwidth = 80 -- automatically create new line when text width is hit
cmd[[ highlight ColorColumn ctermbg=0 guibg=lightgrey ]]

-- Map local leader. Currently used for neorg
g.maplocalleader = ","
