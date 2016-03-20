" author: Marcin Szamotulski
" email: coot[AT]riseup[DOT]net

let s:lbuf = [] " log buffer

fun! GulpHandler(handle, msg)
  let data = substitute(a:msg['data'], '\_s\+$', '', '')
  let type = a:msg['type']
  if (type != 'err' && type != 'task_err' && data =~? '\v^\[[0-9:]+\] working directory changed to')
    return
  endif
  let msg = 'gulp: ' . data
  call add(s:lbuf, msg)

  if mode() != "c" && type != "stdout" && !get(a:msg, "silent", 0)
      echomsg msg
  endif
endfun

fun! GulpServerConnect()
  let s:ch_handle = ch_open("localhost:3746", {"callback": "GulpHandler", "waittime": 200})
  if ch_status(s:ch_handle) == "open"
    return
  endif
  if !exists("s:job") || job_status(s:job) != "run"
    let cmd = ["/bin/sh", "-c", "node --harmony " . split(globpath(&rtp, "scripts/gulp-server.js"), "\n")[0] . (has("unix") ? " 1>/dev/null 2>&1" : "")]
    let s:job = job_start(cmd, {"in_io": "null", "out_io": "null", "err_io": "null"})
    call job_setoptions(s:job, {"stoponexit": 1})
  endif
  let s:ch_handle = ch_open("localhost:3746", {"callback": "GulpHandler", "waittime": 200})
endfun

fun! StopGulpServer()
  if exists("s:ch_handle")
    try
      call ch_close(s:ch_handle)
    catch /E906/
    endtry
    unlet s:ch_handle
  endif
  if exists("s:job")
    try
      call job_stop(s:job)
    endtry
    unlet s:job
  endif
endfun

fun! Gulp(bang, tasks)
  let gulpfile = findfile("gulpfile.js", expand("%:p:h") . ";/")
  if empty(gulpfile)
    echoerr "gulpfile not found"
    return
  endif
  let data = {'type': 'start-tasks', 'args': split(a:tasks, '[[:space:]]\+'), 'silent': !empty(a:bang), 'gulpfile': fnamemodify(gulpfile, ':p')}
  " {"callback": 0} - if callback is specified only the first message is
  " handled, if a message comes next with the same ID, it will be dropped.
  call ch_sendexpr(s:ch_handle, data, {"callback": 0})
endfun

fun! GulpAutoDetect()
  if !exists("s:ch_handle") && !empty(findfile("gulpfile.js", expand("%:p:h") . ";/"))
    call GulpServerConnect()
  endif
endfun

augroup GulpAutoDetect
  au!
  au BufRead * call GulpAutoDetect()
  au VimEnter * call GulpAutoDetect()
augroup END

fun! ListGulpTasks(ArgLead, CmdLine, CursorPos)
  let gulpfile = findfile('gulpfile.js', expand('%:p:h') . ';/')
  if empty(gulpfile)
    return ""
  endif
  try
    let data = ch_evalexpr(s:ch_handle, {'type': 'list-tasks', 'args': 'all', 'gulpfile': fnamemodify(gulpfile, ':p')})
  catch /E906/
    echohl WarningMsg
    echomsg "channel is closed, please run :GulpRestart or :call GulpServerConnect()"
    echohl Normal
    return ""
  endtry
  return type(data) == type({}) ? join(data["tasks"], "\n") : ""
endfun

com! -bang -nargs=+ -complete=custom,ListGulpTasks Gulp :call Gulp(<q-bang>, <q-args>)
com! -count=0 GulpLog :echo join(<count> == 0 ? s:lbuf : s:lbuf[-<count>:], "\n")
" why I need wait 100m?
com! GulpRestart :call StopGulpServer()|sleep 100m|call GulpServerConnect()
com! GulpStatus :echo exists("s:job") && exists("s:ch_handle") ? s:job . " [channel: " . ch_status(s:ch_handle) . "]" : "gulp server not running"
