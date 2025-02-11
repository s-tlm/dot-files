# Path to your oh-my-zsh installation.
typeset -aU path # no repeated directories allowed in path array
export ZSH="$HOME/.oh-my-zsh"

# Use vim key-bindings
set -o vi

# PATHS
# Pygmentize
path+="$HOME/.local/bin"
# Rust
path+="$HOME/.cargo/bin"
# Coursier
path+="$HOME/Library/Application Support/Coursier/bin"

export ZSH_COLORIZE_STYLE="dracula"
export PATH

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time oh-my-zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
ZSH_THEME="robbyrussell"

# Automatically update oh my zsh
zstyle ':omz:update' mode auto

# Uncomment the following line to change how often to auto-update (in days).
zstyle ':omz:update' frequency 7

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Add wisely, as too many plugins slow down shell startup.
plugins=(
	aliases
	git
	poetry
	python
	docker
	terraform
	aws
	zsh-autosuggestions
	colorize
	pass
	dbt
)

source $ZSH/oh-my-zsh.sh

# Aliases
alias cat="ccat"
alias start-zscaler="open -a /Applications/Zscaler/Zscaler.app --hide; sudo find /Library/LaunchDaemons -name '*zscaler*' -exec launchctl load {} \;"
alias kill-zscaler="find /Library/LaunchAgents -name '*zscaler*' -exec launchctl unload {} \;;sudo find /Library/LaunchDaemons -name '*zscaler*' -exec launchctl unload {} \;"
alias make-admin="/Applications/Privileges.app/Contents/Resources/PrivilegesCLI --add"

complete -o nospace -C /opt/homebrew/bin/terraform terraform

# Start Starship
eval "$(starship init zsh)"

add-zsh-hook -Uz chpwd(){ source <(tea -Eds) }  #tea

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

### MANAGED BY RANCHER DESKTOP START (DO NOT EDIT)
export PATH="/Users/stevelam/.rd/bin:$PATH"
### MANAGED BY RANCHER DESKTOP END (DO NOT EDIT)

# Functions
fpath=( ~/.zsh_functions "${fpath[@]}" )
autoload -Uz mtp
autoload -Uz todo
autoload -Uz scrib
autoload -Uz sweep
autoload -Uz compinit && compinit
autoload -U +X bashcompinit && bashcompinit

# Enable zsh syntax highlighting
# Requires brew install zsh-syntax-highlighting
source ~/Dotfiles/zsh/themes/catppuccin_frappe-zsh-syntax-highlighting.zsh
source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh
source ~/.oh-my-zsh/plugins/zsh-interactive-cd/zsh-interactive-cd.plugin.zsh

# Setup pyenv
export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"
