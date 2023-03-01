#!/usr/bin/env bash

PARENTDIR=$(git rev-parse --show-toplevel)
ZSH_SOURCE=$PARENTDIR/zsh/.zshrc
ZSH_TARGET=~/.zshrc
VIM_SOURCE=$PARENTDIR/vim/.vimrc
VIM_TARGET=~/.vimrc
STARSHIP_SOURCE=$PARENTDIR/starship/starship.toml
STARSHIP_TARGET=~/.config/starship.toml

# TODO automate pre-requisite checks
# TODO install missing pre-requisites
# TODO create symlink for custom nvchadrc

echo ""
echo "Are the following installed?"
echo "----------------------------"
echo "SHELL - zsh"
echo "SHELL - oh-my-zsh"
echo "SHELL - starship"
echo "IDE   - neovim"
echo "IDE   - nvchad"
echo "----------------------------"
read -p "Continue with setup? [yn] " input
echo "----------------------------"

if [[ $input =~ ^[Yy]$ ]]; then

    echo "Configuring .zshrc symlink..."

    if test -f "$ZSH_TARGET"; 
    then
        echo -e ".zshrc already exists. Skipped.\n"
    else
        ln -s $ZSH_SOURCE $ZSH_TARGET
        echo ""
    fi

    echo "Configuring Neovim..."
    # Create neovim .config directory if not exists
    if [[ ! -d ~/.config/nvim ]]; then
      mkdir ~/.config/nvim
    fi
    
    echo "Configuring Starship..."

    if test -f "$STARSHIP_TARGET"; 
    then
        echo -e "starship configuration already exists. Skipped.\n"
    else
        mkdir -p ~/.config
        ln -s $STARSHIP_SOURCE $STARSHIP_TARGET
        echo ""
    fi

fi

