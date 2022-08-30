syntax on
set number
set relativenumber
set ruler
set ts=4 sw=4
set laststatus=2
set statusline=%f
set visualbell
set autoindent
set is
set hlsearch
hi Search guibg=LightBlue

" vim-markdown settings
set conceallevel=2

" enable syntax highlighting
if &t_Co > 1
	syntax enable
endif
