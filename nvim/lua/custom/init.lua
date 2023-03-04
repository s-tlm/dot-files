local opt = vim.opt
local cmd = vim.cmd

-- Numbers
opt.relativenumber = true

-- Color lines
opt.colorcolumn = "80"
cmd[[highlight ColorColumn ctermbg=0 guibg=lightgrey]]
