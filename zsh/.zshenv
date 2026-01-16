eval "$(/opt/homebrew/bin/brew shellenv)"

export EDITOR=nvim
export BAT_THEME="Dracula"
export CPPFLAGS="-I/opt/homebrew/opt/openjdk/include"

# uv
export PATH="/Users/slam/.local/bin:$PATH"

# liquibase
export LIQUIBASE_HOME="$HOMEBREW_PREFIX/opt/liquibase/libexec"
