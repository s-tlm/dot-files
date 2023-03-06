local opt = vim.opt
local cmd = vim.cmd

-- Numbers
opt.relativenumber = true

-- Color lines
opt.colorcolumn = "80"
opt.textwidth = 80 -- automatically create new line when text width is hit
cmd[[highlight ColorColumn ctermbg=0 guibg=lightgrey]]
