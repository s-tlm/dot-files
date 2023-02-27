" --------------------------------- Plug-ins ----------------------------------
call plug#begin('~/.nvim/autoload')
" Dracula Theme
Plug 'Mofiqul/dracula.nvim'
" Markdown
Plug 'godlygeek/tabular'
Plug 'preservim/vim-markdown'
" No distractions
Plug 'junegunn/goyo.vim'
" Limelight
Plug 'junegunn/limelight.vim'
" Airline and themes
Plug 'vim-airline/vim-airline'
Plug 'vim-airline/vim-airline-themes'
" Tabular (Align text)
Plug 'godlygeek/tabular'
" Deoplete (Autocompletion)
Plug 'Shougo/deoplete.nvim', { 'do': ':UpdateRemotePlugins' }
" Telescope (fuzzy finder)
Plug 'nvim-lua/plenary.nvim'
Plug 'nvim-telescope/telescope.nvim', { 'tag': '0.1.1' }
" Tree
Plug 'nvim-tree/nvim-web-devicons' " optional, for file icons
Plug 'nvim-tree/nvim-tree.lua'
" Treesitter (syntax highlighting)
Plug 'nvim-treesitter/nvim-treesitter', {'do': ':TSUpdate'}
" Vim Icons 
Plug 'ryanoasis/vim-devicons' " always load last
call plug#end()
" ----------------------------- Plug-in Settings ------------------------------
au vimenter *.md,*.markdown Goyo
" --------------------------------- Visuals -----------------------------------
set number relativenumber " Line numbers relative to current line
set colorcolumn=80 " Mark end of line
highlight ColorColumn ctermbg=0 guibg=lightgrey
set hlsearch " Highlights text when searching
set visualbell " Flash screen instead of beeping
" ---------------------------------- Status -----------------------------------
set expandtab                  " enter spaces when tab is pressed
set textwidth=80               " break lines when line length increases
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
let g:airline_theme='base16_dracula'
" ------------------------------ Key-Bindings ---------------------------------
nnoremap <C-l> :Limelight!! 0.5<CR>
