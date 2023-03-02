#!/usr/bin/env bash

PARENTDIR=$(git rev-parse --show-toplevel)
ZSH_SOURCE=$PARENTDIR/zsh/.zshrc
ZSH_TARGET=~/.zshrc
VIM_SOURCE=$PARENTDIR/vim/.vimrc
VIM_TARGET=~/.vimrc
NEOVIMRC_SOURCE=$PARENTDIR/nvim/lua/custom/chadrc.lua
NEOVIMRC_TARGET=~/.config/nvim/lua/custom/chadrc.lua
NEOVIM_PLUGIN_SOURCE=$PARENTDIR/nvim/lua/custom/plugins/init.lua
NEOVIM_PLUGIN_TARGET=~/.config/nvim/lua/custom/plugins/init.lua
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
    if [[ ! -d ~/.config/nvim/lua/custom/plugins ]]; then
      mkdir -p ~/.config/nvim/lua/custom/plugins
    fi
    if test -f "$NEOVIMRC_TARGET";
    then
      echo -e "chadrc already exists. Skipped.\n"
    else
        ln -s $NEOVIMRC_SOURCE $NEOVIMRC_TARGET
        echo ""
    fi
    if test -f "$NEOVIM_PLUGIN_TARGET";
    then
        echo -e "neovim plugin config exists. Skipped.\n"
    else
        ln -s $NEOVIM_PLUGIN_SOURCE $NEOVIM_PLUGIN_TARGET
        echo ""
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

