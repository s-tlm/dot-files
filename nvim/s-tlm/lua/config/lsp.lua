local conform = require("conform")
local capabilities = require("blink.cmp").get_lsp_capabilities()

-- add the same capabilities to ALL server configurations
vim.lsp.config("*", {
	capabilities = capabilities,
})

-- conform configuration --
vim.api.nvim_create_user_command("FormatDisable", function(args)
	if args.bang then
		-- FormatDisable! will disable formatting just for this buffer
		vim.b.disable_autoformat = true
	else
		vim.g.disable_autoformat = true
	end
end, {
	desc = "Disable autoformat-on-save",
	bang = true,
})
vim.api.nvim_create_user_command("FormatEnable", function()
	vim.b.disable_autoformat = false
	vim.g.disable_autoformat = false
end, {
	desc = "Re-enable autoformat-on-save",
})

-------------------------------------------------------------------------------
-- Setup LSP servers via mason-lspconfig handlers
-- https://github.com/williamboman/mason-lspconfig.nvim#configuration

-- Configure LSP servers using vim.lsp.config() (mason-lspconfig v2.0+)
-- https://github.com/mason-org/mason-lspconfig.nvim/releases/tag/v2.0.0

-- Configure Lua LSP with Neovim-specific settings
vim.lsp.config("lua_ls", {
	on_init = function(client)
		if client.workspace_folders then
			local path = client.workspace_folders[1].name
			if vim.uv.fs_stat(path .. "/.luarc.json") or vim.uv.fs_stat(path .. "/.luarc.jsonc") then
				return
			end
		end

		client.config.settings.Lua = vim.tbl_deep_extend("force", client.config.settings.Lua, {
			runtime = {
				version = "LuaJIT",
			},
			workspace = {
				checkThirdParty = false,
				library = {
					vim.env.VIMRUNTIME,
				},
			},
			diagnostics = {
				globals = { "vim" },
			},
		})
	end,
	settings = {
		Lua = {
			diagnostics = {
				globals = { "vim" },
			},
		},
	},
})

-- Configure Python LSP (basedpyright)
vim.lsp.config("basedpyright", {
	settings = {
		pyright = {
			disableOrganizeImports = true,
		},
		python = {
			analysis = {
				ignore = { "*" },
			},
		},
	},
})
