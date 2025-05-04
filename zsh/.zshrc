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
	pass
	dbt
)

source $ZSH/oh-my-zsh.sh

# Aliases
alias cat="bat"
alias ls="eza --group-directories-first"
alias l="eza -lbF --git"
alias ll="eza -lbGF --git"
alias llm="eza -lbGd --git --sort=modified"
alias la="eza -lbhHigUmuSa --time-style=long-iso --git --color-scale"
alias lx="eza -lbhHigUmuSa@ --time-style=long-iso --git --color-scale"
alias l.="eza -a | grep -E '^\.'" # View dot files only

complete -o nospace -C /opt/homebrew/bin/terraform terraform

# Start Starship
eval "$(starship init zsh)"

[ -f ~/.fzf.zsh ] && source ~/.fzf.zsh

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
