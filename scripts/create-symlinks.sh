#!/usr/bin/env bash

ZSHRC=~/.zshrc
VIMRC=~/.vimrc
NVIMRC=~/.config/nvim/init.vim
SSTOML=~/.config/starship.toml
PARENTDIR=$(git rev-parse --show-toplevel)

echo ""
echo "Are the following installed?"
echo "----------------------------"
echo "SHELL - zsh"
echo "SHELL - oh-my-zsh"
echo "SHELL - starship"
echo "IDE   - neovim"
echo "----------------------------"
read -p "Continue with setup? [yn] " input
echo "----------------------------"

if [[ $input =~ ^[Yy]$ ]]; then
    echo "Setting up ZSH..."

    if test -f "$ZSHRC"; 
    then
        echo -e ".zshrc exists.\n"
    else
        ln -s $PARENTDIR/.zshrc ~/.zshrc
        echo ""
    fi

    echo "Setting up NEOVIM..."
    
    if test -f "$NVIMRC";
    then
        echo -e ".init.vim exists.\n"
    else
        ln -s $PARENTDIR/init.vim ~/.config/nvim/init.vim
        echo ""
    fi

    echo "Setting up Starship..."

    if test -f "$SSTOML"; 
    then
        echo -e "starship.toml exists.\n"
    else
        mkdir -p ~/.config
        ln -s $PARENTDIR/.config/starship.toml ~/.config/starship.toml
        echo ""
    fi
fi

