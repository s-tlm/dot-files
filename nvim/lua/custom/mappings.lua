-- lua/custom/mappings 
local M = {}

M.nvterm = {

  plugin=true,

  t = {
    -- toggle in terminal mode
    -- mac osx alt + ~
    ["†"] = {
      function()
        require("nvterm.terminal").toggle "float"
      end,
      "toggle floating term",
    },
    -- mac osx alt + h
    ["˙"] = {
      function()
        require("nvterm.terminal").toggle "horizontal"
      end,
      "toggle horizontal term",
    },
    -- mac osx alt + v
    ["√"] = {
      function()
        require("nvterm.terminal").toggle "vertical"
      end,
      "toggle vertical term",
    },
  },

  n = {
    -- toggle in normal mode
    -- mac osx alt + ~
    ["†"] = {
      function()
        require("nvterm.terminal").toggle "float"
      end,
      "toggle floating term",
    },
    -- mac osx alt + h
    ["˙"] = {
      function()
        require("nvterm.terminal").toggle "horizontal"
      end,
      "toggle horizontal term",
    },
    -- mac osx alt + v
    ["√"] = {
      function()
        require("nvterm.terminal").toggle "vertical"
      end,
      "toggle vertical term",
    },
    -- enable Glow
    ["<C-p>"] = {":Glow <CR>", "toggle Glow Markdown preview"}
  }
}

return M
