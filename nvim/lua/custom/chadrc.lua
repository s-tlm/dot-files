-- First read our docs (completely) then check the example_config repo

local M = {}

M.ui = {
  theme_toggle = { "aquarium", "blossom" },
  theme = "aquarium",
  transparency = false
}

M.plugins = require "custom.plugins"

M.mappings = require "custom.mappings"

return M