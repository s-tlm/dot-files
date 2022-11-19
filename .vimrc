" --------------------------------- Vundle ------------------------------------
set nocompatible              " be iMproved, required
filetype off                  " required

" set the runtime path to include Vundle and initialize
set rtp+=~/.vim/bundle/Vundle.vim
call vundle#begin()
" alternatively, pass a path where Vundle should install plugins
"call vundle#begin('~/some/path/here')

" let Vundle manage Vundle, required
Plugin 'VundleVim/Vundle.vim'

" Plugins from Github
Plugin 'dracula/vim', { 'name': 'dracula' }
Plugin 'godlygeek/tabular'
Plugin 'preservim/vim-markdown'
Plugin 'tpope/vim-fugitive'
Plugin 'ycm-core/YouCompleteMe'
Plugin 'vim-airline/vim-airline'
Plugin 'preservim/nerdtree'

" All of your Plugins must be added before the following line
call vundle#end()            " required
filetype plugin indent on    " required
" To ignore plugin indent changes, instead use:
"filetype plugin on
"
" Brief help
" :PluginList       - lists configured plugins
" :PluginInstall    - installs plugins; append `!` to update or just :PluginUpdate
" :PluginSearch foo - searches for foo; append `!` to refresh local cache
" :PluginClean      - confirms removal of unused plugins; append `!` to auto-approve removal
"
" see :h vundle for more details or wiki for FAQ
" Put your non-Plugin stuff after this line

" --------------------------------- Visuals -----------------------------------
set number relativenumber " Line numbers relative to current line
set colorcolumn=80 " Mark end of line
highlight ColorColumn ctermbg=0 guibg=lightgrey
set hlsearch " Highlights text when searching
set visualbell " Flash screen instead of beeping

" ---------------------------------- Status -----------------------------------
set expandtab                  " enter spaces when tab is pressed
set textwidth=120              " break lines when line length increases
set tabstop=4                  " use 4 spaces to represent tab
set softtabstop=4
set shiftwidth=4               " number of spaces to use for auto indent
set autoindent
set backspace=indent,eol,start " Set backspace to normal behaviour
set ruler                      " Show current line and column number
set laststatus=2               " Always display status line
set statusline=%f

" -------------------------- Vim-Markdown Settings ----------------------------
set conceallevel=2
let g:vim_markdown_strikethrough = 1

" ---------------------------------- Theme ------------------------------------
syntax enable
set t_Co=256
set background=dark
set termguicolors
colorscheme dracula

" -------------------------------- Key Maps -----------------------------------
nnoremap <C-n> :NERDTreeToggle<CR>
