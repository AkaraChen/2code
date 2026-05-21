unsetopt PROMPT_SP

# Rebind ^J (LF) so Shift+Enter inserts a newline instead of executing.
# Enter still sends ^M (CR) which remains bound to accept-line.
_2code_insert_newline() { LBUFFER+=$'\n'; }
zle -N _2code_insert_newline
bindkey '^J' _2code_insert_newline
