# enable vim keybinds with esc
set -o vi


# path
typeset -aU path # no repeated directories allowed in path array

path+="$HOME/.cargo/bin" # rust

export path


# omz
export ZSH="$HOME/.oh-my-zsh"

zstyle ':omz:update' mode auto
zstyle ':omz:update' frequency 60 # days
zstyle ':omz:update' verbose minimal
zstyle ':omz:*' aliases no
zstyle ':omz:plugins:*' aliases yes

plugins=(
	aliases
	git
	python
	docker
	terraform
	aws
	pass
	dbt
	zsh-autosuggestions
	zsh-interactive-cd
)

fpath=( ~/.zsh_functions "${fpath[@]}" )

source $ZSH/oh-my-zsh.sh


# aliases
alias cat="bat"
alias ls="eza --group-directories-first"
alias l="eza -lbF --git"
alias ll="eza -lbGF --git"
alias llm="eza -lbGd --git --sort=modified"
alias la="eza -lbhHigUmuSa --time-style=long-iso --git --color-scale"
alias lx="eza -lbhHigUmuSa@ --time-style=long-iso --git --color-scale"
alias l.="eza -a | grep -E '^\.'" # View dot files only
alias assume=". assume"


# custom functions (compinit called by oh-my-zsh)
autoload -Uz mtp
autoload -Uz todo
autoload -Uz scrib
autoload -Uz sweep


source "$HOME/.local/bin/env"
source "$HOME/.cargo/env"
# Set up fzf key bindings and fuzzy completion
source <(fzf --zsh)
source ~/Dotfiles/zsh/themes/catppuccin_frappe-zsh-syntax-highlighting.zsh # load last
source /opt/homebrew/share/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh # load last

# starship
eval "$(starship init zsh)"

# ssh-agent
eval "$(ssh-agent -s)"
