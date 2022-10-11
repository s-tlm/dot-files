" --------------------------------- Visuals -----------------------------------
set number relativenumber " Line numbers relative to current line
set colorcolumn=80 " Mark end of line
highlight ColorColumn ctermbg=0 guibg=lightgrey
set hlsearch " Highlights text when searching
set visualbell " Flash screen instead of beeping

" ---------------------------------- Status -----------------------------------
set ruler " Show current line and column number
set tabstop=8 softtabstop=0 expandtab shiftwidth=4 smarttab
set laststatus=2
set statusline=%f
set autoindent " Auto indent lines when typing

" -------------------------- Vim-Markdown Settings ----------------------------
set conceallevel=2

" ---------------------------------- Theme ------------------------------------
packadd! dracula
syntax enable
colorscheme dracula

" ------------------------------- vim Markdown --------------------------------
let g:vim_markdown_strikethrough = 1
