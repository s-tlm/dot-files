local present, null_ls = pcall(require, "null-ls")

if not present then
   return
end

local b = null_ls.builtins

local sources = {

   -- webdev stuff
   b.formatting.deno_fmt,
   b.formatting.prettier,

   -- Lua
   b.formatting.stylua,

   -- Python
   b.formatting.autoflake,
   b.diagnostics.pylint,

   -- Shell
   b.formatting.shfmt,
   b.diagnostics.shellcheck.with { diagnostics_format = "#{m} [#{c}]" },

   -- SQL
   b.diagnostics.sqlfluff.with({
        extra_args = { "--dialect", "postgres" }, -- change to your dialect
   }),

   -- Terraform
   b.formatting.terraform_fmt,

   -- YAML
   b.diagnostics.yamllint,
}

null_ls.setup {
   debug = true,
   sources = sources,
}
