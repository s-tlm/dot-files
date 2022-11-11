#!/usr/bin/env bash

local ZSHRC=~/.zshrc
local VIMRC=~/.vimrc
local SSTOML=~/.config/starship.toml
local PARENTDIR=$(git rev-parse --show-toplevel)

echo ""
echo "Are the following installed?"
echo "----------------------------"
echo "SHELL - zsh"
echo "SHELL - oh-my-zsh"
echo "SHELL - starship"
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

    echo "Setting up VIM..."
    
    if test -f "$VIMRC";
    then
        echo -e ".vimrc exists.\n"
    else
        ln -s $PARENTDIR/.vimrc ~/.vimrc
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

