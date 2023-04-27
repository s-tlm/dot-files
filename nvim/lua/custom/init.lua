local opt = vim.opt
local cmd = vim.cmd
local g = vim.g
local autocmd = vim.api.nvim_create_autocmd

-- Numbers
opt.relativenumber = true

-- Color lines
opt.colorcolumn = "80"
cmd[[ highlight ColorColumn ctermbg=0 guibg=lightgrey ]]

-- Neorg specific configs
g.maplocalleader = ","
-- Set conceal level to 2 when entering .norg files
-- TODO Combine into a single function
autocmd({"BufEnter", "BufWinEnter"}, {
  pattern = {"*.norg"},
  command = "set conceallevel=2"
})
autocmd({"BufEnter", "BufWinEnter"}, {
  pattern = {"*.norg"},
  command = "set concealcursor=nc"
})

